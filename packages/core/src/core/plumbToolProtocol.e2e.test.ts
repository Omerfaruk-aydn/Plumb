/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import type { Content, GenerateContentParameters, Part } from '@google/genai';
import {
  enableToolRouteDiag,
  getLastToolRouteDiag,
  getPlumbModelRegistry,
} from '@google/gemini-cli-provider';
import { LlmRole } from '../telemetry/llmRole.js';
import { PlumbContentGenerator } from './plumbContentGenerator.js';
import { GeminiEventType, Turn } from './turn.js';
import { type GeminiChat, StreamEventType } from './geminiChat.js';
import { makeFakeConfig } from '../test-utils/config.js';
import { PolicyDecision } from '../policy/types.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import {
  PLUMB_TOOL_PROBE_NAME,
  PLUMB_TOOL_PROBE_RESULT,
  PlumbToolProbe,
} from '../tools/plumbToolProbe.js';
import { Scheduler } from '../scheduler/scheduler.js';
import type {
  CompletedToolCall,
  ToolCallRequestInfo,
} from '../scheduler/types.js';
import type { AgentLoopContext } from '../config/agent-loop-context.js';

type Fixture = 'single' | 'parallel' | 'text-tool' | 'pseudo';

interface Counters {
  httpRequest1: number;
  httpRequest2: number;
  request1ToolsCount: number;
  providerToolCallDeltas: number;
  normalizedToolCalls: number;
  coreReceivedToolCalls: number;
  schedulerEnqueued: number;
  executedTools: number;
  toolResults: number;
  assistantContinuation: number;
  renderedText: string;
  serverError?: Error;
}

interface WireToolCall {
  id?: unknown;
}

interface WireMessage {
  role?: unknown;
  tool_calls?: WireToolCall[];
  tool_call_id?: unknown;
  content?: unknown;
}

interface WireRequestBody {
  tools?: unknown[];
  tool_choice?: unknown;
  messages: WireMessage[];
}

const servers = new Set<Server>();
const provider = 'plumb-local-tool-e2e';
const modelId = 'deterministic-tool-model';

afterEach(async () => {
  getPlumbModelRegistry().removeCustomModel(provider, modelId);
  await Promise.all(
    [...servers].map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  servers.clear();
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseWireMessage(value: unknown): WireMessage {
  if (!isRecord(value)) return {};
  const rawCalls = value['tool_calls'];
  return {
    role: value['role'],
    tool_call_id: value['tool_call_id'],
    content: value['content'],
    tool_calls: Array.isArray(rawCalls)
      ? rawCalls.map((call) => (isRecord(call) ? { id: call['id'] } : {}))
      : undefined,
  };
}

function readJsonBody(
  req: import('node:http').IncomingMessage,
): Promise<WireRequestBody> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const parsed: unknown = JSON.parse(body);
        if (!isRecord(parsed) || !Array.isArray(parsed['messages'])) {
          throw new Error('Invalid mock request body');
        }
        resolve({
          tools: Array.isArray(parsed['tools']) ? parsed['tools'] : undefined,
          tool_choice: parsed['tool_choice'],
          messages: parsed['messages'].map(parseWireMessage),
        });
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function writeSse(
  res: import('node:http').ServerResponse,
  payloads: unknown[],
) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
  });
  for (const payload of payloads) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
  res.end('data: [DONE]\n\n');
}

function toolDeltas(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    id: `probe_call_${index + 1}`,
    type: 'function',
    function: { name: PLUMB_TOOL_PROBE_NAME, arguments: '{}' },
  }));
}

async function startMockServer(fixture: Fixture, counters: Counters) {
  let requestNumber = 0;
  const server = createServer(async (req, res) => {
    try {
      const body = await readJsonBody(req);
      requestNumber++;
      if (requestNumber === 1) {
        counters.httpRequest1++;
        counters.request1ToolsCount = Array.isArray(body.tools)
          ? body.tools.length
          : 0;
        expect(counters.request1ToolsCount).toBeGreaterThan(0);
        expect(body.tool_choice).toBe('auto');

        if (fixture === 'pseudo') {
          writeSse(res, [
            {
              choices: [
                {
                  index: 0,
                  delta: {
                    content:
                      '<tool_call>{"name":"plumb_tool_probe","arguments":{}}</tool_call>',
                  },
                },
              ],
            },
            { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
          ]);
          return;
        }

        const count = fixture === 'parallel' ? 3 : 1;
        const payloads: unknown[] = [];
        if (fixture === 'text-tool') {
          payloads.push({
            choices: [
              {
                index: 0,
                delta: { content: "I'll inspect the project." },
              },
            ],
          });
        }
        payloads.push({
          choices: [{ index: 0, delta: { tool_calls: toolDeltas(count) } }],
        });
        payloads.push({
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        });
        writeSse(res, payloads);
        return;
      }

      counters.httpRequest2++;
      const assistant = body.messages.find(
        (message) =>
          message.role === 'assistant' && Array.isArray(message.tool_calls),
      );
      const results = body.messages.filter(
        (message) => message.role === 'tool',
      );
      expect(assistant).toBeDefined();
      if (!assistant?.tool_calls)
        throw new Error('Missing assistant tool calls');
      expect(results).toHaveLength(fixture === 'parallel' ? 3 : 1);
      expect(assistant.tool_calls.map((call) => call.id)).toEqual(
        toolDeltas(fixture === 'parallel' ? 3 : 1).map(
          (call) => `${PLUMB_TOOL_PROBE_NAME}__${call.id}`,
        ),
      );
      for (const result of results) {
        expect(
          assistant.tool_calls.some((call) => call.id === result.tool_call_id),
        ).toBe(true);
        expect(String(result.content)).toContain(PLUMB_TOOL_PROBE_RESULT);
      }
      writeSse(res, [
        {
          choices: [{ index: 0, delta: { content: 'Probe complete.' } }],
        },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ]);
    } catch (error) {
      counters.serverError =
        error instanceof Error ? error : new Error(String(error));
      if (!res.headersSent)
        res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('deterministic mock assertion failed');
    }
  });
  servers.add(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No mock port');
  return `http://127.0.0.1:${address.port}/v1`;
}

async function runFixture(fixture: Fixture): Promise<Counters> {
  const counters: Counters = {
    httpRequest1: 0,
    httpRequest2: 0,
    request1ToolsCount: 0,
    providerToolCallDeltas: 0,
    normalizedToolCalls: 0,
    coreReceivedToolCalls: 0,
    schedulerEnqueued: 0,
    executedTools: 0,
    toolResults: 0,
    assistantContinuation: 0,
    renderedText: '',
  };
  const baseUrl = await startMockServer(fixture, counters);
  getPlumbModelRegistry().addCustomModel({
    id: modelId,
    provider,
    api: 'openai-completions',
    baseUrl,
    contextWindow: 32_000,
    maxTokens: 4096,
    input: 'text',
    toolsSupported: true,
    toolsCapabilitySource: 'USER_CONFIGURED',
    toolPolicy: {
      emission: 'REQUIRED_WHEN_TOOLS_PRESENT',
      forcedToolChoiceSupported: true,
      namedToolChoiceSupported: true,
      parallelToolCallsSupported: true,
      source: 'PROVIDER_CONTRACT',
    },
  });

  const config = makeFakeConfig({
    targetDir: process.cwd(),
    cwd: process.cwd(),
    interactive: false,
    enableHooks: false,
    policyEngineConfig: { defaultDecision: PolicyDecision.ALLOW },
  });
  const messageBus = new MessageBus(config.getPolicyEngine());
  const registry = new ToolRegistry(config, messageBus);
  const probe = new PlumbToolProbe(messageBus);
  registry.registerTool(probe);
  let executeCount = 0;
  const originalBuild = probe.build.bind(probe);
  probe.build = (params) => {
    const invocation = originalBuild(params);
    const originalExecute = invocation.execute.bind(invocation);
    invocation.execute = async (options) => {
      executeCount++;
      return originalExecute(options);
    };
    return invocation;
  };

  const loopContext = {
    config,
    promptId: 'deterministic-probe',
    toolRegistry: registry,
    messageBus,
    promptRegistry: {} as AgentLoopContext['promptRegistry'],
    resourceRegistry: {} as AgentLoopContext['resourceRegistry'],
    geminiClient: {} as AgentLoopContext['geminiClient'],
    sandboxManager: config.sandboxManager,
  } satisfies AgentLoopContext;
  const scheduler = new Scheduler({
    context: loopContext,
    messageBus,
    getPreferredEditor: () => undefined,
    schedulerId: 'deterministic-probe',
  });
  const generator = new PlumbContentGenerator(provider, modelId, 'test-key');
  const declaration = probe.getSchema();
  const initialContents: Content[] = [
    { role: 'user', parts: [{ text: 'Run probe.' }] },
  ];
  const firstRequest: GenerateContentParameters = {
    model: modelId,
    contents: initialContents,
    config: { tools: [{ functionDeclarations: [declaration] }] },
  };

  enableToolRouteDiag();
  const chat = {
    context: { config },
    loopContext,
    getHistory: () => [],
    maybeIncludeSchemaDepthContext: async () => undefined,
    sendMessageStream: async () => {
      const stream = await generator.generateContentStream(
        firstRequest,
        'deterministic-probe',
        LlmRole.MAIN,
      );
      return (async function* () {
        for await (const chunk of stream) {
          yield { type: StreamEventType.CHUNK, value: chunk };
        }
      })();
    },
  } as unknown as GeminiChat;
  const turn = new Turn(chat, 'deterministic-probe');
  const requests: ToolCallRequestInfo[] = [];
  for await (const event of turn.run(
    { model: modelId },
    [{ text: 'Run probe.' }],
    new AbortController().signal,
  )) {
    if (event.type === GeminiEventType.Content) {
      counters.renderedText += event.value;
    } else if (event.type === GeminiEventType.ToolCallRequest) {
      requests.push(event.value);
    }
  }
  if (counters.serverError) throw counters.serverError;
  counters.normalizedToolCalls = Number(
    getLastToolRouteDiag()?.['normalizedToolCallCount'] ?? 0,
  );
  counters.coreReceivedToolCalls = requests.length;
  counters.providerToolCallDeltas = Number(
    getLastToolRouteDiag()?.['responseToolCallDeltaCount'] ?? 0,
  );

  if (requests.length === 0) {
    scheduler.dispose();
    return counters;
  }

  counters.schedulerEnqueued = requests.length;
  const completed = await scheduler.schedule(
    requests,
    new AbortController().signal,
  );
  counters.executedTools = executeCount;
  counters.toolResults = completed.length;

  const secondContents: Content[] = [
    ...initialContents,
    {
      role: 'model',
      parts: requests.map((request) => ({
        functionCall: {
          id: request.callId,
          name: request.name,
          args: request.args,
        },
      })),
    },
    {
      role: 'user',
      parts: completed.flatMap(
        (item: CompletedToolCall): Part[] => item.response.responseParts,
      ),
    },
  ];
  const secondStream = await generator.generateContentStream(
    { ...firstRequest, contents: secondContents },
    'deterministic-probe',
    LlmRole.MAIN,
  );
  for await (const chunk of secondStream) {
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) {
        counters.renderedText += part.text;
        counters.assistantContinuation = 1;
      }
    }
  }
  if (counters.serverError) throw counters.serverError;
  scheduler.dispose();

  return counters;
}

describe('deterministic local structured tool E2E', () => {
  it.each([
    ['single', 1],
    ['parallel', 3],
    ['text-tool', 1],
  ] as const)(
    '%s executes and reinjects without loss or duplication',
    async (fixture, count) => {
      const result = await runFixture(fixture);
      expect(result).toMatchObject({
        httpRequest1: 1,
        httpRequest2: 1,
        providerToolCallDeltas: count,
        normalizedToolCalls: count,
        coreReceivedToolCalls: count,
        schedulerEnqueued: count,
        executedTools: count,
        toolResults: count,
        assistantContinuation: 1,
      });
      expect(result.executedTools - result.normalizedToolCalls).toBe(0);
      if (fixture === 'text-tool') {
        expect(result.renderedText).toContain("I'll inspect the project.");
        expect(result.renderedText).toContain('Probe complete.');
      }
    },
  );

  it('does not schedule textual pseudo tool markup', async () => {
    const result = await runFixture('pseudo');
    expect(result).toMatchObject({
      httpRequest1: 1,
      httpRequest2: 0,
      providerToolCallDeltas: 0,
      normalizedToolCalls: 0,
      coreReceivedToolCalls: 0,
      schedulerEnqueued: 0,
      executedTools: 0,
      toolResults: 0,
      assistantContinuation: 0,
    });
    expect(result.renderedText).toContain('<tool_call>');
  });
});

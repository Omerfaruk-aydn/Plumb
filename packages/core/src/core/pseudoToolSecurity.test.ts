/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pseudo-tool security regression tests.
 *
 * Proves that assistant text shaped like a tool call — XML-looking,
 * JSON-looking, a markdown fenced "tool" block, OpenAI-function-call
 * plaintext, or Anthropic/Gemini-style pseudo-call prose — is NEVER
 * parsed into a real functionCall / tool_call by PlumbContentGenerator,
 * for models whose tool capability is UNKNOWN or UNSUPPORTED (and, for
 * completeness, also when capability is fully SUPPORTED — text is text,
 * never a parse target, regardless of capability).
 *
 * PlumbContentGenerator.generateContentStream only ever emits a
 * functionCall chunk from a structured `event.type === 'tool_call'`
 * stream event (see plumbContentGenerator.ts, the `case 'tool_call':`
 * branch). A `event.type === 'text'` chunk is always forwarded verbatim
 * as a text part (`case 'text': yield this.#chunk({ text: event.text })`)
 * with no regex/parsing step in between. These tests pin that contract
 * down so a future change cannot silently introduce a text-sniffing
 * "helpful" pseudo-tool parser.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GenerateContentParameters } from '@google/genai';
import { LlmRole } from '../telemetry/llmRole.js';

const testRequest: GenerateContentParameters = {
  model: 'unused',
  contents: [{ role: 'user', parts: [{ text: 'list files' }] }],
};
const testRole = LlmRole.MAIN;

const { mockFindModel, mockResolveProviderAlias, mockPlumbModelStream } =
  vi.hoisted(() => {
    let queuedText = '';
    return {
      mockFindModel: vi.fn(),
      mockResolveProviderAlias: vi.fn((id: string) => id),
      mockPlumbModelStream: vi.fn(async function* (): AsyncGenerator<
        Record<string, unknown>
      > {
        yield { type: 'text', text: queuedText };
        yield { type: 'done', finishReason: 'stop' };
      }),
      __setQueuedText: (t: string) => {
        queuedText = t;
      },
    };
  });

vi.mock('@google/gemini-cli-provider', () => ({
  getPlumbModelRegistry: () => ({
    findModel: mockFindModel,
    loadCache: vi.fn(),
  }),
  resolveProviderAlias: mockResolveProviderAlias,
  getLocalProviderEndpointDefinition: vi.fn(),
  resolveLocalProviderBaseUrl: vi.fn(),
  plumbModelStream: mockPlumbModelStream,
}));

vi.mock('./claudeSubscriptionToolBridge.js', () => ({
  createClaudeSubscriptionToolExecutor: vi.fn(),
}));

import { PlumbContentGenerator } from './plumbContentGenerator.js';

// Pseudo-tool-shaped assistant text payloads a model might hallucinate
// when it has no real tool-calling capability but has seen tool-shaped
// text in its training data or system prompt.
const PSEUDO_TOOL_PAYLOADS: Record<string, string> = {
  xml: '<read_file path="package.json" />',
  json: '{"tool":"read_file","path":"package.json"}',
  markdown: '```tool\nread_file package.json\n```',
  openaiFunctionText:
    'function_call: read_file({"path": "package.json"})\n' +
    '<|tool_call|>{"name":"read_file","arguments":{"path":"package.json"}}<|/tool_call|>',
  anthropicGeminiProse:
    '<tool_use><name>read_file</name><input>{"path":"package.json"}</input></tool_use>\n' +
    'functionCall: { name: "read_file", args: { path: "package.json" } }',
};

async function runStreamAndCollectParts(model: {
  id: string;
  provider: string;
  api?: string;
  toolsSupported?: boolean;
}) {
  mockFindModel.mockReturnValue({
    id: model.id,
    provider: model.provider,
    api: model.api ?? 'openai-chat',
    contextWindow: 100_000,
    maxTokens: 4096,
    toolsSupported: model.toolsSupported,
  });

  const generator = new PlumbContentGenerator(
    model.provider,
    model.id,
    'api-key',
  );

  const stream = await generator.generateContentStream(
    testRequest,
    'prompt-id',
    testRole,
  );

  const textParts: string[] = [];
  const functionCallParts: unknown[] = [];
  for await (const chunk of stream) {
    for (const candidate of chunk.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (typeof (part as { text?: string }).text === 'string') {
          textParts.push((part as { text: string }).text);
        }
        if ((part as { functionCall?: unknown }).functionCall) {
          functionCallParts.push(
            (part as { functionCall: unknown }).functionCall,
          );
        }
      }
    }
  }
  return { textParts, functionCallParts };
}

describe('pseudo-tool security regression', () => {
  beforeEach(() => {
    mockFindModel.mockReset();
    mockResolveProviderAlias.mockClear();
    mockPlumbModelStream.mockClear();
  });

  const capabilityCases: Array<{
    label: string;
    toolsSupported: boolean | undefined;
  }> = [
    { label: 'UNKNOWN (undefined)', toolsSupported: undefined },
    { label: 'UNSUPPORTED (false)', toolsSupported: false },
    {
      label: 'SUPPORTED (true) -- text is still never sniffed',
      toolsSupported: true,
    },
  ];

  for (const { label, toolsSupported } of capabilityCases) {
    describe(`capability = ${label}`, () => {
      for (const [kind, payload] of Object.entries(PSEUDO_TOOL_PAYLOADS)) {
        it(`does not execute a tool for pseudo-tool-shaped ${kind} text`, async () => {
          mockPlumbModelStream.mockImplementationOnce(async function* () {
            yield { type: 'text', text: payload };
            yield { type: 'done', finishReason: 'stop' };
          });

          const { textParts, functionCallParts } =
            await runStreamAndCollectParts({
              id: 'pseudo-tool-test-model',
              provider: 'custom-openai-compat',
              toolsSupported,
            });

          // The literal pseudo-tool text is forwarded as ordinary text --
          // never dropped, never silently "executed".
          expect(textParts.join('')).toContain(payload.split('\n')[0]);
          // Zero functionCall/tool_call parts were synthesized from text.
          expect(functionCallParts.length).toBe(0);
        });
      }
    });
  }

  it('a real structured tool_call stream event still produces exactly one functionCall (control case: the pipe is not simply dead)', async () => {
    mockPlumbModelStream.mockImplementationOnce(async function* () {
      yield {
        type: 'tool_call',
        toolCall: {
          id: 'call_1',
          name: 'read_file',
          arguments: '{"path":"package.json"}',
        },
      };
      yield { type: 'done', finishReason: 'tool_calls' };
    });

    const { functionCallParts } = await runStreamAndCollectParts({
      id: 'pseudo-tool-test-model',
      provider: 'custom-openai-compat',
      toolsSupported: true,
    });

    expect(functionCallParts.length).toBe(1);
  });
});

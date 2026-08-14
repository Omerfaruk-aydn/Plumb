/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plumbModelStream } from './streaming.js';
import {
  __resetCustomProviderDefinitionsForTests,
  setCustomProviderDefinitions,
  type CustomProviderDefinition,
} from '../config/customProviderDefinitions.js';
import { PlumbModelRegistry } from '../registry/model-registry.js';
import type { PlumbStreamEvent } from '../types.js';

const OPENAI_ID = 'custom:aaaaaaaa-e89b-42d3-a456-426614174000';
const ANTHROPIC_ID = 'custom:bbbbbbbb-e89b-42d3-a456-426614174000';
const GEMINI_ID = 'custom:cccccccc-e89b-42d3-a456-426614174000';

const DEFINITIONS: CustomProviderDefinition[] = [
  {
    version: 1,
    id: OPENAI_ID,
    displayName: 'Custom OpenAI',
    dialect: 'openai-completions',
    baseUrl: 'https://openai-proxy.example.test/v1',
    credentialPlacement: 'bearer',
    safeHeaders: { 'X-Tenant': 'openai-tenant' },
    manualModels: [{ id: 'openai-private-model' }],
  },
  {
    version: 1,
    id: ANTHROPIC_ID,
    displayName: 'Custom Anthropic',
    dialect: 'anthropic-messages',
    baseUrl: 'https://anthropic-proxy.example.test',
    credentialPlacement: 'x-api-key',
    safeHeaders: { 'X-Tenant': 'anthropic-tenant' },
    manualModels: [{ id: 'anthropic-private-model' }],
  },
  {
    version: 1,
    id: GEMINI_ID,
    displayName: 'Custom Gemini',
    dialect: 'google-generative-ai',
    baseUrl: 'https://gemini-proxy.example.test/v1beta',
    credentialPlacement: 'query-key',
    safeHeaders: { 'X-Tenant': 'gemini-tenant' },
    manualModels: [{ id: 'gemini-private-model' }],
  },
];

const API_KEYS: Record<string, string> = {
  [OPENAI_ID]: 'openai-canary-key',
  [ANTHROPIC_ID]: 'anthropic-canary-key',
  [GEMINI_ID]: 'gemini-canary-key',
};

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

function header(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

async function drain(
  registry: PlumbModelRegistry,
  providerId: string,
  modelId: string,
): Promise<PlumbStreamEvent[]> {
  const model = registry.findModel(providerId, modelId);
  if (!model) throw new Error(`model not found: ${providerId}/${modelId}`);
  const events: PlumbStreamEvent[] = [];
  for await (const e of plumbModelStream({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    apiKey: API_KEYS[providerId],
  })) {
    events.push(e);
  }
  return events;
}

describe('Phase 7 custom-provider switch matrix (zero cross-definition bleed)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const captured: CapturedRequest[] = [];

  beforeEach(() => {
    captured.length = 0;
    setCustomProviderDefinitions(DEFINITIONS);
    fetchSpy = vi.fn(async (url: unknown, init?: RequestInit) => {
      captured.push({
        url: String(url),
        headers: { ...(init?.headers as Record<string, string>) },
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetCustomProviderDefinitionsForTests();
  });

  it('runs the full CUSTOM_OPENAI -> CUSTOM_ANTHROPIC -> CUSTOM_GEMINI -> CUSTOM_OPENAI chain with zero credential/header/endpoint/model/dialect bleed', async () => {
    const registry = new PlumbModelRegistry();
    registry.hydrateCustomProviderModels();

    const chain: Array<{ providerId: string; modelId: string }> = [
      { providerId: OPENAI_ID, modelId: 'openai-private-model' },
      { providerId: ANTHROPIC_ID, modelId: 'anthropic-private-model' },
      { providerId: GEMINI_ID, modelId: 'gemini-private-model' },
      { providerId: OPENAI_ID, modelId: 'openai-private-model' },
    ];

    for (const step of chain) {
      const events = await drain(registry, step.providerId, step.modelId);
      expect(events.some((e) => e.type === 'error')).toBe(false);
    }

    expect(captured).toHaveLength(4);
    const [req1, req2, req3, req4] = captured;

    // CUSTOM_OPENAI: Bearer auth, its own tenant header, its own endpoint.
    for (const req of [req1, req4]) {
      expect(req.url).toBe(
        'https://openai-proxy.example.test/v1/chat/completions',
      );
      expect(header(req.headers, 'Authorization')).toBe(
        'Bearer openai-canary-key',
      );
      expect(header(req.headers, 'X-Tenant')).toBe('openai-tenant');
      expect(header(req.headers, 'x-api-key')).toBeUndefined();
      expect(JSON.stringify(req.headers)).not.toContain('anthropic-canary');
      expect(JSON.stringify(req.headers)).not.toContain('gemini-canary');
      expect(JSON.stringify(req.headers)).not.toContain('anthropic-tenant');
      expect(JSON.stringify(req.headers)).not.toContain('gemini-tenant');
    }

    // CUSTOM_ANTHROPIC: x-api-key auth, its own tenant header, its own
    // endpoint -- must not inherit CUSTOM_OPENAI's Bearer header or tenant.
    expect(req2.url).toBe('https://anthropic-proxy.example.test/v1/messages');
    expect(header(req2.headers, 'x-api-key')).toBe('anthropic-canary-key');
    expect(header(req2.headers, 'X-Tenant')).toBe('anthropic-tenant');
    expect(header(req2.headers, 'Authorization')).toBeUndefined();
    expect(JSON.stringify(req2.headers)).not.toContain('openai-canary');
    expect(JSON.stringify(req2.headers)).not.toContain('gemini-canary');
    expect(JSON.stringify(req2.headers)).not.toContain('openai-tenant');
    expect(JSON.stringify(req2.headers)).not.toContain('gemini-tenant');

    // CUSTOM_GEMINI: query-key credential (never a header), its own tenant
    // header, its own endpoint -- must not inherit either prior provider's
    // Authorization/x-api-key or tenant.
    expect(req3.url).toBe(
      'https://gemini-proxy.example.test/v1beta/models/gemini-private-model:streamGenerateContent?alt=sse&key=gemini-canary-key',
    );
    expect(header(req3.headers, 'X-Tenant')).toBe('gemini-tenant');
    expect(header(req3.headers, 'Authorization')).toBeUndefined();
    expect(header(req3.headers, 'x-api-key')).toBeUndefined();
    expect(JSON.stringify(req3.headers)).not.toContain('openai-canary');
    expect(JSON.stringify(req3.headers)).not.toContain('anthropic-canary');
    expect(JSON.stringify(req3.headers)).not.toContain('openai-tenant');
    expect(JSON.stringify(req3.headers)).not.toContain('anthropic-tenant');

    // Closing the loop: the second CUSTOM_OPENAI request is identical in
    // shape to the first -- no state accumulated from the two intervening
    // requests to different definitions.
    expect(req4.headers).toEqual(req1.headers);
    expect(req4.url).toBe(req1.url);
  });

  it.each([
    [OPENAI_ID, 'openai-private-model', 'openai'],
    [ANTHROPIC_ID, 'anthropic-private-model', 'anthropic'],
    [GEMINI_ID, 'gemini-private-model', 'gemini'],
  ] as const)(
    '%s completes native structured call normalization and result replay',
    async (providerId, modelId, dialect) => {
      captured.length = 0;
      let requestNumber = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: unknown, init?: RequestInit) => {
          requestNumber++;
          captured.push({
            url: String(url),
            headers: { ...(init?.headers as Record<string, string>) },
            body: JSON.parse(String(init?.body ?? '{}')) as Record<
              string,
              unknown
            >,
          });
          if (requestNumber === 2) {
            if (dialect === 'anthropic') {
              return new Response(
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"continued"}}\n\n' +
                  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
                { status: 200 },
              );
            }
            if (dialect === 'gemini') {
              return new Response(
                'data: {"candidates":[{"content":{"parts":[{"text":"continued"}]},"finishReason":"STOP"}]}\n\n',
                { status: 200 },
              );
            }
            return new Response(
              'data: {"choices":[{"delta":{"content":"continued"},"index":0}]}\n\n' +
                'data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}]}\n\n' +
                'data: [DONE]\n\n',
              { status: 200 },
            );
          }
          if (dialect === 'anthropic') {
            return new Response(
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_custom","name":"plumb_tool_probe","input":{}}}\n\n' +
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n' +
                'data: {"type":"content_block_stop","index":0}\n\n' +
                'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
              { status: 200 },
            );
          }
          if (dialect === 'gemini') {
            return new Response(
              'data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"call_custom","name":"plumb_tool_probe","args":{}}}]},"finishReason":"STOP"}]}\n\n',
              { status: 200 },
            );
          }
          return new Response(
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_custom","type":"function","function":{"name":"plumb_tool_probe","arguments":"{}"}}]},"index":0}]}\n\n' +
              'data: {"choices":[{"delta":{},"finish_reason":"tool_calls","index":0}]}\n\n' +
              'data: [DONE]\n\n',
            { status: 200 },
          );
        }),
      );

      const registry = new PlumbModelRegistry();
      registry.hydrateCustomProviderModels();
      const baseModel = registry.findModel(providerId, modelId)!;
      const model = {
        ...baseModel,
        toolsSupported: true as const,
        toolsCapabilitySource: 'USER_CONFIGURED' as const,
      };
      const tool = {
        type: 'function' as const,
        function: {
          name: 'plumb_tool_probe',
          description: 'Harmless diagnostic',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      };
      const firstEvents: PlumbStreamEvent[] = [];
      for await (const event of plumbModelStream({
        model,
        messages: [{ role: 'user', content: 'Run probe.' }],
        tools: [tool],
        toolChoice: { mode: 'named', name: 'plumb_tool_probe' },
        apiKey: API_KEYS[providerId],
      })) {
        firstEvents.push(event);
      }
      const calls = firstEvents.filter((event) => event.type === 'tool_call');
      expect(calls).toEqual([
        {
          type: 'tool_call',
          toolCall: {
            id: 'call_custom',
            name: 'plumb_tool_probe',
            arguments: '{}',
          },
        },
      ]);

      const continuation: PlumbStreamEvent[] = [];
      for await (const event of plumbModelStream({
        model,
        messages: [
          { role: 'user', content: 'Run probe.' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_call',
                id: 'call_custom',
                name: 'plumb_tool_probe',
                arguments: '{}',
              },
            ],
          },
          {
            role: 'tool',
            name: 'plumb_tool_probe',
            toolCallId: 'call_custom',
            content: 'PLUMB_TOOL_PROBE_OK',
          },
        ],
        tools: [tool],
        apiKey: API_KEYS[providerId],
      })) {
        continuation.push(event);
      }
      expect(continuation).toContainEqual({ type: 'text', text: 'continued' });
      expect(captured).toHaveLength(2);
      const firstBody = captured[0].body!;
      const replayBody = captured[1].body!;
      if (dialect === 'openai') {
        expect(firstBody['tools']).toBeDefined();
        expect(firstBody['tool_choice']).toEqual({
          type: 'function',
          function: { name: 'plumb_tool_probe' },
        });
        expect(JSON.stringify(replayBody)).toContain('tool_call_id');
      } else if (dialect === 'anthropic') {
        expect(firstBody['tools']).toBeDefined();
        expect(firstBody['tool_choice']).toEqual({
          type: 'tool',
          name: 'plumb_tool_probe',
        });
        expect(JSON.stringify(replayBody)).toContain('tool_result');
        expect(JSON.stringify(replayBody)).toContain('call_custom');
      } else {
        expect(firstBody['tools']).toBeDefined();
        expect(firstBody['toolConfig']).toEqual({
          functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: ['plumb_tool_probe'],
          },
        });
        expect(JSON.stringify(replayBody)).toContain('functionResponse');
        expect(JSON.stringify(replayBody)).toContain('call_custom');
      }
    },
  );
});

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GenerateContentParameters } from '@google/genai';
import { LlmRole } from '../telemetry/llmRole.js';
import {
  tokenLimit,
  hasKnownTokenLimit,
  __resetPlumbContextWindowCacheForTests,
} from './tokenLimits.js';

const testRequest: GenerateContentParameters = {
  model: 'unused',
  contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
};
const testRole = LlmRole.MAIN;

const {
  mockFindModel,
  mockResolveProviderAlias,
  mockPlumbModelStream,
  mockCreateClaudeSubscriptionToolExecutor,
  sentinelToolExecutor,
  mockLoadCache,
  mockGetLocalProviderEndpointDefinition,
  mockResolveLocalProviderBaseUrl,
} = vi.hoisted(() => {
  const sentinelToolExecutor = vi.fn();
  return {
    mockFindModel: vi.fn(),
    mockResolveProviderAlias: vi.fn((id: string) =>
      id === 'antigravity' ? 'google-antigravity' : id,
    ),
    mockPlumbModelStream: vi.fn(async function* (_args: {
      model: { provider: string };
    }) {
      yield { candidates: [{ content: { parts: [], role: 'model' } }] };
    }),
    mockCreateClaudeSubscriptionToolExecutor: vi
      .fn()
      .mockReturnValue(sentinelToolExecutor),
    sentinelToolExecutor,
    mockLoadCache: vi.fn(),
    mockGetLocalProviderEndpointDefinition: vi.fn(),
    mockResolveLocalProviderBaseUrl: vi.fn(),
  };
});

vi.mock('@google/gemini-cli-provider', () => ({
  getPlumbModelRegistry: () => ({
    findModel: mockFindModel,
    loadCache: mockLoadCache,
  }),
  resolveProviderAlias: mockResolveProviderAlias,
  getLocalProviderEndpointDefinition: mockGetLocalProviderEndpointDefinition,
  resolveLocalProviderBaseUrl: mockResolveLocalProviderBaseUrl,
  plumbModelStream: mockPlumbModelStream,
}));

vi.mock('./claudeSubscriptionToolBridge.js', () => ({
  createClaudeSubscriptionToolExecutor:
    mockCreateClaudeSubscriptionToolExecutor,
}));

import { PlumbContentGenerator } from './plumbContentGenerator.js';

describe('PlumbContentGenerator', () => {
  beforeEach(() => {
    mockFindModel.mockReset();
    mockResolveProviderAlias.mockClear();
    mockPlumbModelStream.mockClear();
    mockCreateClaudeSubscriptionToolExecutor.mockClear();
    mockCreateClaudeSubscriptionToolExecutor.mockReturnValue(
      sentinelToolExecutor,
    );
    mockLoadCache.mockReset();
    mockGetLocalProviderEndpointDefinition.mockReset();
    mockResolveLocalProviderBaseUrl.mockReset();
  });

  it('routes the transport using the canonical OMP provider id from the registry lookup, not the raw PLUMB presentation id', async () => {
    // The catalog projects `google-antigravity` (the OMP id) onto
    // PlumbModel.provider even though callers select it via the PLUMB
    // presentation id "antigravity" (see catalog/providers.ts PLUMB_TO_OMP_ID).
    mockFindModel.mockReturnValue({
      id: 'claude-sonnet-4-6',
      provider: 'google-antigravity',
      api: 'google-antigravity',
      contextWindow: 200000,
      maxTokens: 65536,
      reasoning: true,
      input: 'text',
    });

    const generator = new PlumbContentGenerator(
      'antigravity',
      'claude-sonnet-4-6',
      'api-key',
    );

    const stream = await generator.generateContentStream(
      testRequest,
      'prompt-id',
      testRole,
    );
    for await (const _ of stream) {
      // drain
    }

    expect(mockPlumbModelStream).toHaveBeenCalledTimes(1);
    const { model } = mockPlumbModelStream.mock.calls[0][0];
    expect(model.provider).toBe('google-antigravity');
  });

  // Bug 5 regression: packages/core's own client-side token-budget
  // bookkeeping (tokenLimits.ts) has no way to resolve a non-Gemini
  // model's real contextWindow itself -- this generator must feed the
  // registry's real value into it on every request, keyed by the exact
  // model id, so compaction/overflow checks stop using a Gemini-only
  // default for e.g. Claude Subscription or OpenCode models.
  describe('feeds the real per-model contextWindow into tokenLimits.ts', () => {
    afterEach(() => {
      __resetPlumbContextWindowCacheForTests();
    });

    it('records the registry-reported contextWindow for the exact model id used', async () => {
      mockFindModel.mockReturnValue({
        id: 'claude-opus-4-8',
        provider: 'claude-subscription',
        api: 'claude-agent-sdk',
        contextWindow: 200_000,
        maxTokens: 32_000,
        reasoning: true,
        input: 'text',
      });

      const generator = new PlumbContentGenerator(
        'claude-subscription',
        'claude-opus-4-8',
        'api-key',
      );
      const stream = await generator.generateContentStream(
        testRequest,
        'prompt-id',
        testRole,
      );
      for await (const _ of stream) {
        // drain
      }

      expect(tokenLimit('claude-opus-4-8')).toBe(200_000);
    });

    it('CONTEXT_METADATA_BLEED = ZERO: two different models in sequence each keep their own recorded contextWindow', async () => {
      mockFindModel.mockReturnValueOnce({
        id: 'claude-opus-4-8',
        provider: 'claude-subscription',
        api: 'claude-agent-sdk',
        contextWindow: 200_000,
        maxTokens: 32_000,
        reasoning: true,
        input: 'text',
      });
      const first = new PlumbContentGenerator(
        'claude-subscription',
        'claude-opus-4-8',
        'api-key',
      );
      for await (const _ of await first.generateContentStream(
        testRequest,
        'prompt-id',
        testRole,
      )) {
        // drain
      }

      mockFindModel.mockReturnValueOnce({
        id: 'grok-4.5',
        provider: 'opencode-go',
        api: 'openai-completions',
        contextWindow: 128_000,
        maxTokens: 16_000,
        reasoning: false,
        input: 'text',
      });
      const second = new PlumbContentGenerator(
        'opencode-go',
        'grok-4.5',
        'api-key',
      );
      for await (const _ of await second.generateContentStream(
        testRequest,
        'prompt-id',
        testRole,
      )) {
        // drain
      }

      expect(tokenLimit('claude-opus-4-8')).toBe(200_000);
      expect(tokenLimit('grok-4.5')).toBe(128_000);
    });

    it('marks the model UNKNOWN (not a fabricated guess) when the registry has no real contextWindow for it, e.g. a Claude Subscription generic alias', async () => {
      mockFindModel.mockReturnValue({
        id: 'opus',
        provider: 'claude-subscription',
        api: 'claude-agent-sdk',
        // No contextWindow: mirrors a live-discovered generic alias with
        // no pinned reference match (universal-model-inventory.ts's
        // GENERIC_FLOOR case).
        maxTokens: undefined,
        reasoning: true,
        input: 'text',
      });

      const generator = new PlumbContentGenerator(
        'claude-subscription',
        'opus',
        'api-key',
      );
      const stream = await generator.generateContentStream(
        testRequest,
        'prompt-id',
        testRole,
      );
      for await (const _ of stream) {
        // drain
      }

      expect(hasKnownTokenLimit('opus')).toBe(false);
    });
  });

  it('fails closed without a hydrated descriptor instead of fabricating an OpenAI route', async () => {
    mockFindModel.mockReturnValue(undefined);

    const generator = new PlumbContentGenerator(
      'antigravity',
      'claude-sonnet-4-6',
      'api-key',
    );

    const stream = await generator.generateContentStream(
      testRequest,
      'prompt-id',
      testRole,
    );
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(mockLoadCache).toHaveBeenCalledWith('antigravity');
    expect(mockPlumbModelStream).not.toHaveBeenCalled();
    expect(chunks).toHaveLength(1);
    expect(chunks[0].candidates?.[0]?.content?.parts?.[0]?.text).toContain(
      'MODEL_NOT_REGISTERED',
    );
  });

  it('preserves an unaliased provider id unchanged', async () => {
    mockFindModel.mockReturnValue({
      id: 'gpt-oss-120b-medium',
      provider: 'nvidia',
      api: 'openai-completions',
    });

    const generator = new PlumbContentGenerator(
      'nvidia',
      'gpt-oss-120b-medium',
      'api-key',
    );

    const stream = await generator.generateContentStream(
      testRequest,
      'prompt-id',
      testRole,
    );
    for await (const _ of stream) {
      // drain
    }

    const { model } = mockPlumbModelStream.mock.calls[0][0];
    expect(model.provider).toBe('nvidia');
  });

  it('preserves the normalized provider finish reason in non-streaming responses', async () => {
    mockFindModel.mockReturnValue({
      id: 'local-model',
      provider: 'vllm',
      api: 'openai-completions',
    });
    mockPlumbModelStream.mockImplementationOnce(async function* () {
      yield { type: 'text', text: 'partial' };
      yield { type: 'done', finishReason: 'max_tokens' };
    } as never);
    const generator = new PlumbContentGenerator('vllm', 'local-model', '');

    const response = await generator.generateContent(
      testRequest,
      'prompt-id',
      testRole,
    );

    expect(response.candidates?.[0]?.finishReason).toBe('MAX_TOKENS');
    expect(response.candidates?.[0]?.content?.parts).toEqual([
      { text: 'partial' },
    ]);
  });

  it('forwards output, JSON-schema, temperature, and reasoning controls', async () => {
    mockFindModel.mockReturnValue({
      id: 'local-model',
      provider: 'vllm',
      api: 'openai-completions',
    });
    const generator = new PlumbContentGenerator('vllm', 'local-model', '');
    const request = {
      ...testRequest,
      config: {
        maxOutputTokens: 321,
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        },
        thinkingConfig: { thinkingLevel: 'HIGH' },
      },
    } as GenerateContentParameters;

    const stream = await generator.generateContentStream(
      request,
      'prompt-id',
      testRole,
    );
    for await (const _chunk of stream) {
      // drain
    }

    expect(mockPlumbModelStream).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 321,
        temperature: 0.3,
        reasoningEffort: 'high',
        responseFormat: {
          type: 'json_schema',
          json_schema: {
            name: 'response',
            strict: true,
            schema: request.config?.responseSchema,
          },
        },
      }),
    );
  });

  it('preserves inline image parts for multimodal provider transports', async () => {
    mockFindModel.mockReturnValue({
      id: 'vision-model',
      provider: 'lm-studio',
      api: 'openai-completions',
      input: ['text', 'image'],
    });
    const generator = new PlumbContentGenerator(
      'lm-studio',
      'vision-model',
      '',
    );
    const request = {
      ...testRequest,
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Describe this image' },
            {
              inlineData: {
                mimeType: 'image/png',
                data: 'aW1hZ2UtYnl0ZXM=',
              },
            },
          ],
        },
      ],
    } as GenerateContentParameters;

    const stream = await generator.generateContentStream(
      request,
      'prompt-id',
      testRole,
    );
    for await (const _chunk of stream) {
      // drain
    }

    expect(mockPlumbModelStream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image' },
              {
                type: 'image',
                imageUrl: 'data:image/png;base64,aW1hZ2UtYnl0ZXM=',
                mimeType: 'image/png',
              },
            ],
          },
        ],
      }),
    );
  });

  it.each([
    ['ollama', 'llama3:8b', 'ollama-chat', 'http://ollama-box:11434/v1'],
    [
      'lm-studio',
      'local-lm',
      'openai-completions',
      'http://studio-box:1234/v1',
    ],
    [
      'llama-cpp',
      'gguf-model',
      'openai-completions',
      'http://llama-box:8080/v1',
    ],
    ['vllm', 'served-qwen', 'openai-completions', 'http://vllm-box:8000/v1'],
    [
      'sglang',
      'sglang-qwen',
      'openai-completions',
      'http://sglang-box:30000/v1',
    ],
  ])(
    'hydrates %s persisted model metadata before cold-start request #1',
    async (provider, modelId, api, baseUrl) => {
      mockFindModel.mockReturnValueOnce(undefined).mockReturnValueOnce({
        id: modelId,
        provider,
        api,
        baseUrl,
      });

      const generator = new PlumbContentGenerator(provider, modelId, '');
      const stream = await generator.generateContentStream(
        testRequest,
        'prompt-id',
        testRole,
      );
      for await (const _ of stream) {
        // drain
      }

      expect(mockLoadCache).toHaveBeenCalledWith(provider);
      const { model } = mockPlumbModelStream.mock.calls[0][0];
      expect(model).toMatchObject({ provider, id: modelId, api, baseUrl });
    },
  );

  it('routes an offline local model to its configured endpoint without generic-provider fallback', async () => {
    mockFindModel.mockReturnValue(undefined);
    mockGetLocalProviderEndpointDefinition.mockReturnValue({
      providerId: 'sglang',
      api: 'openai-completions',
    });
    mockResolveLocalProviderBaseUrl.mockReturnValue('http://10.0.0.8:30000/v1');

    const generator = new PlumbContentGenerator('sglang', 'qwen-local', '');
    const stream = await generator.generateContentStream(
      testRequest,
      'prompt-id',
      testRole,
    );
    for await (const _ of stream) {
      // drain
    }

    const { model } = mockPlumbModelStream.mock.calls[0][0];
    expect(model).toMatchObject({
      provider: 'sglang',
      id: 'qwen-local',
      api: 'openai-completions',
      baseUrl: 'http://10.0.0.8:30000/v1',
    });
  });

  describe('#convertMessages — tool-call/tool-result history (regression: previously flattened to "[Tool: name]" placeholder text with no id, breaking every multi-turn tool continuation)', () => {
    beforeEach(() => {
      mockFindModel.mockReturnValue({
        id: 'gpt-5.5',
        provider: 'openai',
        api: 'openai-completions',
      });
    });

    it('preserves the functionCall id and structured args as a tool_call content part on the assistant turn', async () => {
      const generator = new PlumbContentGenerator(
        'openai',
        'gpt-5.5',
        'sk-test',
      );
      const request: GenerateContentParameters = {
        model: 'unused',
        contents: [
          { role: 'user', parts: [{ text: 'What files are here?' }] },
          {
            role: 'model',
            parts: [
              { text: 'Let me check.' },
              {
                functionCall: {
                  id: 'call_abc123',
                  name: 'list_files',
                  args: { path: '.' },
                },
              },
            ],
          },
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  id: 'call_abc123',
                  name: 'list_files',
                  response: { files: ['README.md'] },
                },
              },
            ],
          },
        ],
      };

      const stream = await generator.generateContentStream(
        request,
        'prompt-id',
        testRole,
      );
      for await (const _ of stream) {
        // drain
      }

      const { messages } = mockPlumbModelStream.mock.calls[0][0] as unknown as {
        messages: Array<{
          role: string;
          content: unknown;
          toolCallId?: string;
        }>;
      };

      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(Array.isArray(assistantMsg?.content)).toBe(true);
      const content = assistantMsg!.content as Array<Record<string, unknown>>;
      expect(content).toContainEqual({ type: 'text', text: 'Let me check.' });
      expect(content).toContainEqual({
        type: 'tool_call',
        id: 'call_abc123',
        name: 'list_files',
        arguments: JSON.stringify({ path: '.' }),
      });
      // The old bug: no assistant message ever carried a real tool_call —
      // just a fake text placeholder like "[Tool: list_files]".
      expect(
        content.some(
          (p) => p['type'] === 'text' && String(p['text']).includes('[Tool:'),
        ),
      ).toBe(false);

      const toolMsg = messages.find((m) => m.role === 'tool');
      expect(toolMsg?.toolCallId).toBe('call_abc123');
      const toolContent = toolMsg!.content as Array<Record<string, unknown>>;
      expect(toolContent[0]).toMatchObject({
        type: 'tool_result',
        id: 'call_abc123',
        result: JSON.stringify({ files: ['README.md'] }),
      });
    });

    it('splits parallel tool calls into one tool-result PlumbMessage per functionResponse, each with its own toolCallId', async () => {
      const generator = new PlumbContentGenerator(
        'openai',
        'gpt-5.5',
        'sk-test',
      );
      const request: GenerateContentParameters = {
        model: 'unused',
        contents: [
          { role: 'user', parts: [{ text: 'go' }] },
          {
            role: 'model',
            parts: [
              { functionCall: { id: 'call_1', name: 'a', args: {} } },
              { functionCall: { id: 'call_2', name: 'b', args: {} } },
            ],
          },
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  id: 'call_1',
                  name: 'a',
                  response: { ok: true },
                },
              },
              {
                functionResponse: {
                  id: 'call_2',
                  name: 'b',
                  response: { ok: false },
                },
              },
            ],
          },
        ],
      };

      const stream = await generator.generateContentStream(
        request,
        'prompt-id',
        testRole,
      );
      for await (const _ of stream) {
        // drain
      }

      const { messages } = mockPlumbModelStream.mock.calls[0][0] as unknown as {
        messages: Array<{ role: string; toolCallId?: string }>;
      };
      const toolMsgs = messages.filter((m) => m.role === 'tool');
      expect(toolMsgs.map((m) => m.toolCallId).sort()).toEqual([
        'call_1',
        'call_2',
      ]);
    });

    it('yields a functionCall chunk carrying the real tool-call id (not just name/args)', async () => {
      (
        mockPlumbModelStream as unknown as {
          mockImplementationOnce: (fn: () => AsyncGenerator<unknown>) => void;
        }
      ).mockImplementationOnce(async function* () {
        yield {
          type: 'tool_call',
          toolCall: {
            id: 'call_xyz',
            name: 'read_file',
            arguments: '{"path":"a.ts"}',
          },
        };
        yield { type: 'done', finishReason: 'stop' };
      });

      const generator = new PlumbContentGenerator(
        'openai',
        'gpt-5.5',
        'sk-test',
      );
      const stream = await generator.generateContentStream(
        testRequest,
        'prompt-id',
        testRole,
      );
      interface FunctionCallChunk {
        candidates: Array<{
          content: {
            parts: Array<{
              functionCall?: { id: string; name: string; args: unknown };
            }>;
          };
        }>;
      }
      const chunks: unknown[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const fnCallChunk = chunks.find(
        (c) =>
          (c as FunctionCallChunk).candidates?.[0]?.content?.parts?.[0]
            ?.functionCall,
      ) as FunctionCallChunk;
      expect(fnCallChunk.candidates[0].content.parts[0].functionCall).toEqual({
        id: 'call_xyz',
        name: 'read_file',
        args: { path: 'a.ts' },
      });
    });
  });

  describe('Claude Subscription tool-authority wiring (regression: must never leak into other providers)', () => {
    beforeEach(() => {
      mockFindModel.mockReturnValue({
        id: 'claude-sonnet-5',
        provider: 'claude-subscription',
        api: 'claude-agent-sdk',
        contextWindow: 200000,
        maxTokens: 64000,
        reasoning: true,
        input: 'text',
      });
    });

    const fakeConfig = {} as never;
    const requestWithTools = {
      model: 'unused',
      contents: [{ role: 'user', parts: [{ text: 'read a file' }] }],
      config: {
        abortSignal: new AbortController().signal,
        tools: [
          {
            functionDeclarations: [
              {
                name: 'read_file',
                description: 'Read a file',
                parameters: { type: 'object', properties: {} },
              },
            ],
          },
        ],
      },
    } as unknown as GenerateContentParameters;

    it('wires a real toolExecutor when provider=claude-subscription, api=claude-agent-sdk, tools are present, and a real Config + AbortSignal are available', async () => {
      const generator = new PlumbContentGenerator(
        'claude-subscription',
        'claude-sonnet-5',
        '',
        fakeConfig,
      );
      const stream = await generator.generateContentStream(
        requestWithTools,
        'prompt-id',
        testRole,
      );
      for await (const _ of stream) {
        // drain
      }

      expect(mockCreateClaudeSubscriptionToolExecutor).toHaveBeenCalledTimes(1);
      expect(mockCreateClaudeSubscriptionToolExecutor).toHaveBeenCalledWith(
        fakeConfig,
        'prompt-id',
        requestWithTools.config!.abortSignal,
      );
      const { toolExecutor } = mockPlumbModelStream.mock.calls[0][0] as {
        toolExecutor?: unknown;
      };
      expect(toolExecutor).toBe(sentinelToolExecutor);
    });

    it('does NOT wire a toolExecutor when no Config was supplied at construction (e.g. direct unit-test construction)', async () => {
      const generator = new PlumbContentGenerator(
        'claude-subscription',
        'claude-sonnet-5',
        '',
        // no gcConfig
      );
      const stream = await generator.generateContentStream(
        requestWithTools,
        'prompt-id',
        testRole,
      );
      for await (const _ of stream) {
        // drain
      }

      expect(mockCreateClaudeSubscriptionToolExecutor).not.toHaveBeenCalled();
      const { toolExecutor } = mockPlumbModelStream.mock.calls[0][0] as {
        toolExecutor?: unknown;
      };
      expect(toolExecutor).toBeUndefined();
    });

    it('does NOT wire a toolExecutor for a non-claude-agent-sdk provider, even with tools present and a real Config', async () => {
      mockFindModel.mockReturnValue({
        id: 'gpt-5.5',
        provider: 'openai',
        api: 'openai-completions',
        contextWindow: 200000,
        maxTokens: 64000,
        reasoning: true,
        input: 'text',
      });
      const generator = new PlumbContentGenerator(
        'openai',
        'gpt-5.5',
        'api-key',
        fakeConfig,
      );
      const stream = await generator.generateContentStream(
        requestWithTools,
        'prompt-id',
        testRole,
      );
      for await (const _ of stream) {
        // drain
      }

      expect(mockCreateClaudeSubscriptionToolExecutor).not.toHaveBeenCalled();
      const { toolExecutor } = mockPlumbModelStream.mock.calls[0][0] as {
        toolExecutor?: unknown;
      };
      expect(toolExecutor).toBeUndefined();
    });

    it('does NOT wire a toolExecutor when there are no tools for this turn', async () => {
      const generator = new PlumbContentGenerator(
        'claude-subscription',
        'claude-sonnet-5',
        '',
        fakeConfig,
      );
      const stream = await generator.generateContentStream(
        testRequest, // no config.tools
        'prompt-id',
        testRole,
      );
      for await (const _ of stream) {
        // drain
      }

      expect(mockCreateClaudeSubscriptionToolExecutor).not.toHaveBeenCalled();
    });
  });

  // ─── GLOBAL TOOL SCHEMA regression ─────────────────────────────────
  //
  // Every real PLUMB tool declares its schema on `parametersJsonSchema`
  // (see tools/definitions/dynamic-declaration-helpers.ts and
  // coreTools.ts) -- `parameters` is a different, mutually-exclusive
  // legacy `@google/genai` field PLUMB's own declarations never
  // populate. Reading the wrong field silently collapsed every tool's
  // real schema to `{}` (no `type`) before it reached ANY provider
  // (Claude Subscription, OpenCode Go/Zen, Antigravity, Anthropic,
  // ...) -- this generator is the shared, provider-neutral bridge, not
  // a Claude-specific path.
  describe('canonical tool schema (parametersJsonSchema is the real shape every tool uses)', () => {
    beforeEach(() => {
      mockFindModel.mockReturnValue({
        id: 'grok-4.5',
        provider: 'opencode-go',
        api: 'openai-completions',
        contextWindow: 128000,
        maxTokens: 16000,
        reasoning: false,
        input: 'text',
      });
    });

    it('forwards the real parametersJsonSchema to the wire tool, never a fabricated {}', async () => {
      const request = {
        model: 'unused',
        contents: [{ role: 'user', parts: [{ text: 'update the topic' }] }],
        config: {
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'update_topic',
                  description: 'Manages narrative flow.',
                  parametersJsonSchema: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      strategic_intent: { type: 'string' },
                    },
                    required: ['strategic_intent'],
                  },
                },
              ],
            },
          ],
        },
      } as unknown as GenerateContentParameters;

      const generator = new PlumbContentGenerator(
        'opencode-go',
        'grok-4.5',
        'api-key',
      );
      const stream = await generator.generateContentStream(
        request,
        'prompt-id',
        testRole,
      );
      for await (const _ of stream) {
        // drain
      }

      const { tools } = mockPlumbModelStream.mock.calls[0][0] as unknown as {
        tools: Array<{
          function: { name: string; parameters: unknown };
        }>;
      };
      expect(tools).toHaveLength(1);
      expect(tools[0].function.name).toBe('update_topic');
      expect(tools[0].function.parameters).toEqual({
        type: 'object',
        properties: {
          title: { type: 'string' },
          strategic_intent: { type: 'string' },
        },
        required: ['strategic_intent'],
      });
    });

    it('normalizes a genuinely no-argument tool to the canonical {type:"object",properties:{},additionalProperties:false} shape, never bare {}', async () => {
      const request = {
        model: 'unused',
        contents: [{ role: 'user', parts: [{ text: 'complete the task' }] }],
        config: {
          tools: [
            {
              functionDeclarations: [
                { name: 'complete_task', description: 'Finish.' },
              ],
            },
          ],
        },
      } as unknown as GenerateContentParameters;

      const generator = new PlumbContentGenerator(
        'opencode-go',
        'grok-4.5',
        'api-key',
      );
      const stream = await generator.generateContentStream(
        request,
        'prompt-id',
        testRole,
      );
      for await (const _ of stream) {
        // drain
      }

      const { tools } = mockPlumbModelStream.mock.calls[0][0] as unknown as {
        tools: Array<{ function: { parameters: unknown } }>;
      };
      expect(tools[0].function.parameters).toEqual({
        type: 'object',
        properties: {},
        additionalProperties: false,
      });
    });

    it('fails closed BEFORE any network usage when a tool schema is structurally invalid (never sends the request)', async () => {
      const request = {
        model: 'unused',
        contents: [{ role: 'user', parts: [{ text: 'broken tool' }] }],
        config: {
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'update_topic',
                  description: 'Manages narrative flow.',
                  // Malformed: root type is not "object".
                  parametersJsonSchema: { type: null },
                },
              ],
            },
          ],
        },
      } as unknown as GenerateContentParameters;

      const generator = new PlumbContentGenerator(
        'opencode-go',
        'grok-4.5',
        'api-key',
      );
      const stream = await generator.generateContentStream(
        request,
        'prompt-id',
        testRole,
      );
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(mockPlumbModelStream).not.toHaveBeenCalled();
      const text = JSON.stringify(chunks);
      expect(text).toContain('INVALID_TOOL_SCHEMA');
      expect(text).toContain('update_topic');
      expect(text).toContain('ROOT_TYPE_NOT_OBJECT');
    });

    it('fails closed when required references a property that does not exist', async () => {
      const request = {
        model: 'unused',
        contents: [{ role: 'user', parts: [{ text: 'broken tool' }] }],
        config: {
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'read_file',
                  description: 'Reads a file.',
                  parametersJsonSchema: {
                    type: 'object',
                    properties: { path: { type: 'string' } },
                    required: ['path', 'nonexistent_property'],
                  },
                },
              ],
            },
          ],
        },
      } as unknown as GenerateContentParameters;

      const generator = new PlumbContentGenerator(
        'opencode-go',
        'grok-4.5',
        'api-key',
      );
      const stream = await generator.generateContentStream(
        request,
        'prompt-id',
        testRole,
      );
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(mockPlumbModelStream).not.toHaveBeenCalled();
      const text = JSON.stringify(chunks);
      expect(text).toContain('INVALID_TOOL_SCHEMA');
      expect(text).toContain('REQUIRED_PROPERTY_MISSING:nonexistent_property');
    });

    it('TOOL_SCHEMA_BLEED = ZERO: a failed-closed request never poisons the next request on the same generator instance', async () => {
      const brokenRequest = {
        model: 'unused',
        contents: [{ role: 'user', parts: [{ text: 'broken tool' }] }],
        config: {
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'update_topic',
                  parametersJsonSchema: { type: null },
                },
              ],
            },
          ],
        },
      } as unknown as GenerateContentParameters;

      const validRequest = {
        model: 'unused',
        contents: [{ role: 'user', parts: [{ text: 'merhaba' }] }],
        config: {
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'read_file',
                  parametersJsonSchema: {
                    type: 'object',
                    properties: { path: { type: 'string' } },
                    required: ['path'],
                  },
                },
              ],
            },
          ],
        },
      } as unknown as GenerateContentParameters;

      const generator = new PlumbContentGenerator(
        'opencode-go',
        'grok-4.5',
        'api-key',
      );

      // Request 1: fails closed, never reaches the transport.
      const brokenStream = await generator.generateContentStream(
        brokenRequest,
        'prompt-1',
        testRole,
      );
      for await (const _ of brokenStream) {
        // drain
      }
      expect(mockPlumbModelStream).not.toHaveBeenCalled();

      // Request 2 on the SAME generator instance: must be a completely
      // normal request with its own real tool schema, unaffected by
      // request 1's failure.
      const okStream = await generator.generateContentStream(
        validRequest,
        'prompt-2',
        testRole,
      );
      for await (const _ of okStream) {
        // drain
      }
      expect(mockPlumbModelStream).toHaveBeenCalledTimes(1);
      const { tools } = mockPlumbModelStream.mock.calls[0][0] as unknown as {
        tools: Array<{ function: { name: string; parameters: unknown } }>;
      };
      expect(tools).toHaveLength(1);
      expect(tools[0].function.name).toBe('read_file');
      expect(tools[0].function.parameters).toEqual({
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      });
    });
  });
});

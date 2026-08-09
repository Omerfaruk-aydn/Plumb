/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GenerateContentParameters } from '@google/genai';
import { LlmRole } from '../telemetry/llmRole.js';

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

  it('hydrates a persisted dynamic model cache before cold-start request #1', async () => {
    mockFindModel.mockReturnValueOnce(undefined).mockReturnValueOnce({
      id: 'local-model',
      provider: 'lm-studio',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:4321/v1',
    });

    const generator = new PlumbContentGenerator('lm-studio', 'local-model', '');
    const stream = await generator.generateContentStream(
      testRequest,
      'prompt-id',
      testRole,
    );
    for await (const _ of stream) {
      // drain
    }

    expect(mockLoadCache).toHaveBeenCalledWith('lm-studio');
    const { model } = mockPlumbModelStream.mock.calls[0][0];
    expect(model).toMatchObject({
      provider: 'lm-studio',
      id: 'local-model',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:4321/v1',
    });
  });

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
});

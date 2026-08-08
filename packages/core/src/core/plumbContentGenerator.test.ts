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

const { mockFindModel, mockResolveProviderAlias, mockPlumbModelStream } =
  vi.hoisted(() => ({
    mockFindModel: vi.fn(),
    mockResolveProviderAlias: vi.fn((id: string) =>
      id === 'antigravity' ? 'google-antigravity' : id,
    ),
    mockPlumbModelStream: vi.fn(async function* (_args: {
      model: { provider: string };
    }) {
      yield { candidates: [{ content: { parts: [], role: 'model' } }] };
    }),
  }));

vi.mock('@google/gemini-cli-provider', () => ({
  getPlumbModelRegistry: () => ({ findModel: mockFindModel }),
  resolveProviderAlias: mockResolveProviderAlias,
  plumbModelStream: mockPlumbModelStream,
}));

import { PlumbContentGenerator } from './plumbContentGenerator.js';

describe('PlumbContentGenerator', () => {
  beforeEach(() => {
    mockFindModel.mockReset();
    mockResolveProviderAlias.mockClear();
    mockPlumbModelStream.mockClear();
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

  it('falls back to resolving the alias itself when the registry has no match', async () => {
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
    for await (const _ of stream) {
      // drain
    }

    const { model } = mockPlumbModelStream.mock.calls[0][0];
    expect(model.provider).toBe('google-antigravity');
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
});

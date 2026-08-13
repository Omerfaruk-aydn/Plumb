/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cross-dialect regression for the normalized-provider ->
 * PlumbContentGenerator -> Turn boundary. Native wire parsers are covered in
 * packages/provider; this matrix proves every registered dialect's normalized
 * structured event reaches Turn as exactly one ToolCallRequest.
 */

import { describe, expect, it, vi } from 'vitest';
import type { GenerateContentParameters } from '@google/genai';
import type { PlumbKnownApi } from '@google/gemini-cli-provider';
import { LlmRole } from '../telemetry/llmRole.js';
import { type GeminiChat, StreamEventType } from './geminiChat.js';
import { GeminiEventType, Turn } from './turn.js';

const { routeState, mockFindModel, mockPlumbModelStream } = vi.hoisted(() => {
  const routeState: {
    provider: string;
    model: string;
    api: string;
  } = {
    provider: 'openai',
    model: 'fixture-model',
    api: 'openai-completions',
  };
  return {
    routeState,
    mockFindModel: vi.fn(() => ({
      id: routeState.model,
      provider: routeState.provider,
      api: routeState.api,
      contextWindow: 32_000,
      maxTokens: 4096,
      input: 'text',
      toolsSupported: true,
    })),
    mockPlumbModelStream: vi.fn(async function* () {
      yield {
        type: 'tool_call',
        toolCall: {
          id: 'native_call_1',
          name: 'plumb_tool_probe',
          arguments: '{}',
        },
      };
      yield { type: 'done', finishReason: 'tool_calls' };
    }),
  };
});

vi.mock('@google/gemini-cli-provider', () => ({
  getPlumbModelRegistry: () => ({
    findModel: mockFindModel,
    loadCache: vi.fn(),
  }),
  resolveProviderAlias: (provider: string) => provider,
  getLocalProviderEndpointDefinition: vi.fn(),
  resolveLocalProviderBaseUrl: vi.fn(),
  plumbModelStream: mockPlumbModelStream,
}));

const { PlumbContentGenerator } = await import('./plumbContentGenerator.js');

const routes: ReadonlyArray<
  readonly [label: string, provider: string, api: PlumbKnownApi]
> = [
  ['OpenAI Chat Completions', 'openai', 'openai-completions'],
  ['OpenAI Responses', 'openai', 'openai-responses'],
  ['OpenAI Codex', 'openai-codex', 'openai-codex-responses'],
  ['Azure Responses', 'azure', 'azure-openai-responses'],
  ['Anthropic Messages', 'anthropic-api', 'anthropic-messages'],
  ['Bedrock Converse', 'amazon-bedrock', 'bedrock-converse-stream'],
  ['Gemini API', 'google', 'google-generative-ai'],
  ['Gemini CLI/Antigravity', 'antigravity', 'google-gemini-cli'],
  ['Vertex', 'google-vertex', 'google-vertex'],
  ['Ollama', 'ollama', 'ollama-chat'],
  ['OpenRouter', 'openrouter', 'openrouter'],
  ['Claude Agent SDK', 'claude-subscription', 'claude-agent-sdk'],
  ['watsonx', 'watsonx', 'watsonx-chat'],
  ['OCI Responses', 'oci-genai', 'oci-openai-responses'],
  ['Cursor agent', 'cursor', 'cursor-agent'],
  ['Devin agent', 'devin', 'devin-agent'],
  ['GitLab Duo agent', 'gitlab-duo-agent', 'gitlab-duo-agent'],
];

describe('cross-dialect PlumbContentGenerator -> Turn structured-call bridge', () => {
  it.each(routes)(
    '%s reaches Turn exactly once',
    async (_label, provider, api) => {
      routeState.provider = provider;
      routeState.api = api;
      routeState.model = `${provider}-fixture-model`;
      mockFindModel.mockClear();
      mockPlumbModelStream.mockClear();

      const generator = new PlumbContentGenerator(
        provider,
        routeState.model,
        'fixture-credential',
      );
      const request: GenerateContentParameters = {
        model: routeState.model,
        contents: [{ role: 'user', parts: [{ text: 'Run probe.' }] }],
      };
      const config = {
        isContextManagementEnabled: () => false,
        getLogRagSnippets: () => false,
      };
      const chat = {
        context: { config },
        loopContext: {
          toolRegistry: { getTool: () => undefined },
        },
        getHistory: () => [],
        maybeIncludeSchemaDepthContext: async () => undefined,
        sendMessageStream: async () => {
          const stream = await generator.generateContentStream(
            request,
            'dialect-bridge',
            LlmRole.MAIN,
          );
          return (async function* () {
            for await (const chunk of stream) {
              yield { type: StreamEventType.CHUNK, value: chunk };
            }
          })();
        },
      } as unknown as GeminiChat;

      const calls = [];
      for await (const event of new Turn(chat, 'dialect-bridge').run(
        { model: routeState.model },
        [{ text: 'Run probe.' }],
        new AbortController().signal,
      )) {
        if (event.type === GeminiEventType.ToolCallRequest)
          calls.push(event.value);
      }

      expect(mockPlumbModelStream).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        callId: 'plumb_tool_probe__native_call_1',
        name: 'plumb_tool_probe',
        args: {},
      });
    },
  );
});

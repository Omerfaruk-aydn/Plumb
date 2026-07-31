/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { type ContentGenerator } from './contentGenerator.js';
import type {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  Content,
  Part,
  FunctionCall,
} from '@google/genai';
import type { LlmRole } from '../telemetry/llmRole.js';
import type { UserTierId, GeminiUserTier } from '../code_assist/types.js';
import { debugLogger } from '../utils/debugLogger.js';

interface PlumbTransportModule {
  plumbModelStream: (options: {
    model: {
      id: string;
      provider: string;
      api: string;
      contextWindow: number;
      maxTokens: number;
      reasoning: boolean;
      input: string;
    };
    messages: Array<{ role: string; content: unknown }>;
    tools: Array<{
      type: string;
      function: { name: string; description: string; parameters: unknown };
    }>;
    apiKey: string;
    signal?: AbortSignal;
    systemPrompt?: string;
  }) => AsyncGenerator<{
    type: string;
    text?: string;
    thinkingText?: string;
    toolCall?: { id: string; name: string; arguments: string };
    usage?: {
      inputTokens: number;
      outputTokens: number;
      reasoningTokens?: number;
      totalTokens: number;
    };
    error?: { code: string; message: string };
    finishReason?: string;
  }>;
}

/**
 * ContentGenerator that streams through the PLUMB provider subsystem.
 */
export class PlumbContentGenerator implements ContentGenerator {
  readonly #providerId: string;
  readonly #modelId: string;
  readonly #apiKey: string;

  userTier?: UserTierId;
  userTierName?: string;
  paidTier?: GeminiUserTier;

  constructor(providerId: string, modelId: string, apiKey: string) {
    this.#providerId = providerId;
    this.#modelId = modelId;
    this.#apiKey = apiKey;
  }

  async generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<GenerateContentResponse> {
    const parts: Part[] = [];
    let usageMetadata: GenerateContentResponse['usageMetadata'];

    const stream = this.generateContentStream(request, userPromptId, role);
    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          parts.push(part);
        }
      }
      if (chunk.usageMetadata) {
        usageMetadata = chunk.usageMetadata;
      }
    }

    const finishReason = parts.length > 0 ? 'STOP' : 'OTHER';

    return {
      candidates: [
        {
          content: { parts, role: 'model' },
          finishReason:
            finishReason as GenerateContentResponse['candidates'][0]['finishReason'],
          index: 0,
        },
      ],
      usageMetadata,
    } as GenerateContentResponse;
  }

  async *generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): AsyncGenerator<GenerateContentResponse> {
    let plumbModule: PlumbTransportModule;
    try {
       
      plumbModule = await import('@google/gemini-cli-provider');
    } catch (err) {
      debugLogger.error('Failed to load PLUMB provider subsystem:', err);
      yield this.#errorChunk('PLUMB provider subsystem not available.');
      return;
    }

    const messages = this.#convertMessages(request.contents ?? []);
    const tools = this.#convertTools(request.config?.tools ?? []);
    const systemPrompt = this.#extractSystemPrompt(request);

    try {
      const stream = plumbModule.plumbModelStream({
        model: {
          id: this.#modelId,
          provider: this.#providerId,
          api: 'openai-completions',
          contextWindow: 200000,
          maxTokens: 65536,
          reasoning: true,
          input: 'text',
        },
        messages,
        tools,
        apiKey: this.#apiKey,
        signal: request.config?.abortSignal,
        systemPrompt,
      });

      for await (const event of stream) {
        switch (event.type) {
          case 'text':
            yield this.#chunk({ parts: [{ text: event.text }] });
            break;

          case 'thinking':
            yield this.#chunk({ parts: [{ thought: event.thinkingText }] });
            break;

          case 'tool_call':
            if (event.toolCall) {
              yield this.#chunk({
                parts: [
                  {
                    functionCall: {
                      name: event.toolCall.name,
                      args: safeParseJson(event.toolCall.arguments),
                    } as FunctionCall,
                  },
                ],
              });
            }
            break;

          case 'usage':
            if (event.usage) {
              yield {
                candidates: [
                  {
                    content: { parts: [], role: 'model' },
                    finishReason: undefined as unknown as string,
                    index: 0,
                  },
                ],
                usageMetadata: {
                  promptTokenCount: event.usage.inputTokens,
                  candidatesTokenCount: event.usage.outputTokens,
                  thoughtsTokenCount: event.usage.reasoningTokens,
                  totalTokenCount: event.usage.totalTokens,
                },
              } as GenerateContentResponse;
            }
            break;

          case 'error':
            yield this.#errorChunk(event.error?.message ?? 'Provider error');
            return;

          case 'done':
            yield {
              candidates: [
                {
                  content: { parts: [], role: 'model' },
                  finishReason: (event.finishReason ??
                    'STOP') as GenerateContentResponse['candidates'][0]['finishReason'],
                  index: 0,
                },
              ],
            } as GenerateContentResponse;
            break;

          default:
            // Unknown event type — skip
            break;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        yield {
          candidates: [
            {
              content: { parts: [], role: 'model' },
              finishReason:
                'STOP' as GenerateContentResponse['candidates'][0]['finishReason'],
              index: 0,
            },
          ],
        } as GenerateContentResponse;
        return;
      }
      debugLogger.error('PlumbContentGenerator stream error:', err);
      yield this.#errorChunk(
        err instanceof Error ? err.message : 'Unknown stream error',
      );
    }
  }

  async countTokens(
    _request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    return {
      totalTokens: 0,
      totalBillableCharacters: 0,
    } as CountTokensResponse;
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    throw new Error('Embedding not supported via PLUMB provider transport.');
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  #chunk(parts: { parts: Part[] }): GenerateContentResponse {
    return {
      candidates: [
        {
          content: { parts: parts.parts, role: 'model' },
          finishReason: undefined as unknown as string,
          index: 0,
        },
      ],
    } as GenerateContentResponse;
  }

  #errorChunk(message: string): GenerateContentResponse {
    return {
      candidates: [
        {
          content: { parts: [{ text: `Error: ${message}` }], role: 'model' },
          finishReason: 'OTHER',
          index: 0,
        },
      ],
    } as GenerateContentResponse;
  }

  #convertMessages(
    contents: Content[],
  ): Array<{ role: string; content: unknown }> {
    const result: Array<{ role: string; content: unknown }> = [];
    for (const content of contents) {
      if (!content.parts) continue;
      for (const part of content.parts) {
        const role =
          content.role === 'model' ? 'assistant' : (content.role ?? 'user');
        if (part.text) {
          result.push({ role, content: part.text });
        } else if ('functionCall' in part && part.functionCall) {
          const fc = part.functionCall as { name?: string; args?: unknown };
          result.push({
            role: 'assistant',
            content: `[Tool: ${fc.name ?? 'unknown'}(${JSON.stringify(fc.args ?? {})})]`,
          });
        } else if ('functionResponse' in part && part.functionResponse) {
          const fr = part.functionResponse as {
            name?: string;
            response?: unknown;
          };
          result.push({
            role: 'tool',
            content: JSON.stringify(fr.response ?? {}),
          });
        }
      }
    }
    return result;
  }

  #convertTools(
    tools: GenerateContentParameters['config']['tools'],
  ): Array<{
    type: string;
    function: { name: string; description: string; parameters: unknown };
  }> {
    if (!tools || tools.length === 0) return [];
    return tools.flatMap((t) => {
      const decls = (
        t as {
          functionDeclarations?: Array<{
            name: string;
            description: string;
            parameters?: unknown;
          }>;
        }
      ).functionDeclarations;
      if (!decls) return [];
      return decls.map((fd) => ({
        type: 'function' as const,
        function: {
          name: fd.name,
          description: fd.description,
          parameters: fd.parameters ?? {},
        },
      }));
    });
  }

  #extractSystemPrompt(request: GenerateContentParameters): string | undefined {
    const instruction = request.config?.systemInstruction as
      | { parts?: Array<{ text?: string }> }
      | undefined;
    if (!instruction?.parts) return undefined;
    return instruction.parts.map((p) => p.text ?? '').join('\n') || undefined;
  }
}

function safeParseJson(str: string): Record<string, unknown> {
  try {
     
    const parsed = JSON.parse(str);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

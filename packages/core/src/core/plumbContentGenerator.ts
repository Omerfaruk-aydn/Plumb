/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * PlumbContentGenerator — bridges PLUMB's ContentGenerator interface
 * to the OMP-derived provider transport subsystem.
 */

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { type ContentGenerator } from './contentGenerator.js';
import type {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
} from '@google/genai';
import type { LlmRole } from '../telemetry/llmRole.js';
import type { UserTierId, GeminiUserTier } from '../code_assist/types.js';
import { debugLogger } from '../utils/debugLogger.js';

export class PlumbContentGenerator implements ContentGenerator {
  readonly #instanceId = `cg-${Math.random().toString(36).slice(2, 10)}`;
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
    const parts: any[] = [];
    let usageMetadata: any;

    const stream = await this.generateContentStream(
      request,
      userPromptId,
      role,
    );
    for await (const chunk of stream) {
      const candidate = (chunk as any).candidates?.[0];
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          parts.push(part);
        }
      }
      if ((chunk as any).usageMetadata) {
        usageMetadata = (chunk as any).usageMetadata;
      }
    }

    return {
      candidates: [
        {
          content: { parts, role: 'model' },
          finishReason: 'STOP' as any,
          index: 0,
        },
      ],
      usageMetadata,
    } as unknown as GenerateContentResponse;
  }

  generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    return Promise.resolve(this.#doStream(request));
  }

  async *#doStream(
    request: GenerateContentParameters,
  ): AsyncGenerator<GenerateContentResponse> {
    let plumbModule: any;
    try {
      plumbModule = await import('@google/gemini-cli-provider');
    } catch (err) {
      debugLogger.error('Failed to load PLUMB provider subsystem:', err);
      yield this.#errorChunk('PLUMB provider subsystem not available.');
      return;
    }

    const contents = (request as any).contents ?? [];
    const messages = this.#convertMessages(contents);
    const tools = this.#convertTools((request as any).config?.tools ?? []);
    const systemPrompt = this.#extractSystemPrompt(request);

    // Look up the full model from the registry to get baseUrl and other metadata.
    // The registry's OMP catalog carries the provider-specific base URL
    // (e.g. https://integrate.api.nvidia.com/v1 for NVIDIA).
    // Without this lookup, the transport falls back to https://api.openai.com/v1.
    let registryModel: Record<string, any> | undefined;
    try {
      const registry = plumbModule.getPlumbModelRegistry?.();
      if (registry) {
        registryModel = registry.findModel(this.#providerId, this.#modelId);
      }
    } catch {
      // Non-fatal: fall through with bare model object
    }

    const model: Record<string, any> = {
      // Start with registry model if available (carries baseUrl, api, contextWindow, etc.)
      ...(registryModel ?? {}),
      // Always override with the explicit selection to prevent model ID prefix
      // inference from replacing the routing provider.
      id: this.#modelId,
      provider: this.#providerId,
      api: (registryModel as any)?.api ?? 'openai-completions',
      contextWindow: (registryModel as any)?.contextWindow ?? 200000,
      maxTokens: (registryModel as any)?.maxTokens ?? 65536,
      reasoning: (registryModel as any)?.reasoning ?? true,
      input: (registryModel as any)?.input ?? 'text',
    };

    try {
      const stream = plumbModule.plumbModelStream({
        model,
        messages,
        tools,
        apiKey: this.#apiKey,
        signal: (request as any).config?.abortSignal as AbortSignal | undefined,
        systemPrompt,
        traceSource: 'NORMAL_CHAT',
        generatorInstance: {
          instanceId: this.#instanceId,
          providerAtConstruction: this.#providerId,
          modelAtConstruction: this.#modelId,
          currentProvider: this.#providerId,
          currentModel: this.#modelId,
        },
      });

      for await (const event of stream) {
        switch (event.type) {
          case 'text':
            yield this.#chunk({ text: event.text });
            break;
          case 'thinking':
            yield this.#chunk({ thought: event.thinkingText });
            break;
          case 'tool_call':
            if (event.toolCall) {
              yield this.#chunk({
                functionCall: {
                  name: event.toolCall.name,
                  args: safeParseJson(event.toolCall.arguments),
                },
              });
            }
            break;
          case 'usage':
            if (event.usage) {
              yield {
                candidates: [
                  {
                    content: { parts: [], role: 'model' },
                    finishReason: undefined as any,
                    index: 0,
                  },
                ],
                usageMetadata: {
                  promptTokenCount: event.usage.inputTokens,
                  candidatesTokenCount: event.usage.outputTokens,
                  thoughtsTokenCount: event.usage.reasoningTokens,
                  totalTokenCount: event.usage.totalTokens,
                },
              } as unknown as GenerateContentResponse;
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
                  finishReason: event.finishReason ?? 'STOP',
                  index: 0,
                },
              ],
            } as unknown as GenerateContentResponse;
            break;
          default:
            break;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
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

  #chunk(part: Record<string, unknown>): GenerateContentResponse {
    return {
      candidates: [
        {
          content: { parts: [part], role: 'model' },
          finishReason: undefined as any,
          index: 0,
        },
      ],
    } as unknown as GenerateContentResponse;
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
    } as unknown as GenerateContentResponse;
  }

  #convertMessages(contents: any[]): Array<{ role: string; content: unknown }> {
    const result: Array<{ role: string; content: unknown }> = [];
    if (!Array.isArray(contents)) return result;
    for (const content of contents) {
      if (!content.parts) continue;
      for (const part of content.parts) {
        const role =
          content.role === 'model' ? 'assistant' : (content.role ?? 'user');
        if (part.text) {
          result.push({ role, content: part.text });
        } else if (part.functionCall) {
          result.push({
            role: 'assistant',
            content: `[Tool: ${part.functionCall.name ?? 'unknown'}]`,
          });
        } else if (part.functionResponse) {
          result.push({
            role: 'tool',
            content: JSON.stringify(part.functionResponse.response ?? {}),
          });
        }
      }
    }
    return result;
  }

  #convertTools(tools: any[]): Array<{
    type: string;
    function: { name: string; description: string; parameters: unknown };
  }> {
    if (!Array.isArray(tools) || tools.length === 0) return [];
    return tools.flatMap((t: any) => {
      const decls = t.functionDeclarations;
      if (!Array.isArray(decls)) return [];
      return decls.map((fd: any) => ({
        type: 'function' as const,
        function: {
          name: String(fd.name ?? ''),
          description: String(fd.description ?? ''),
          parameters: fd.parameters ?? {},
        },
      }));
    });
  }

  #extractSystemPrompt(request: GenerateContentParameters): string | undefined {
    const instruction = (request as any).config?.systemInstruction as
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

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
import type { Config } from '../config/config.js';
import { debugLogger } from '../utils/debugLogger.js';
import {
  recordPlumbModelContextWindow,
  recordPlumbModelContextWindowUnknown,
} from './tokenLimits.js';
import {
  validateCanonicalToolSchema,
  InvalidToolSchemaError,
  CANONICAL_NO_ARGS_SCHEMA,
} from '../tools/definitions/canonicalSchemaValidator.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toGeminiFinishReason(reason: unknown): string {
  if (typeof reason !== 'string') return 'STOP';
  switch (reason.toLowerCase()) {
    case 'stop':
    case 'end_turn':
    case 'stop_sequence':
    case 'tool_calls':
    case 'tool_use':
      return 'STOP';
    case 'length':
    case 'max_tokens':
      return 'MAX_TOKENS';
    case 'content_filter':
    case 'safety':
      return 'SAFETY';
    case 'cancelled':
    case 'canceled':
    case 'other':
      return 'OTHER';
    default:
      return reason.toUpperCase();
  }
}

export class PlumbContentGenerator implements ContentGenerator {
  readonly #instanceId = `cg-${Math.random().toString(36).slice(2, 10)}`;
  readonly #providerId: string;
  readonly #modelId: string;
  readonly #apiKey: string;
  readonly #gcConfig?: Config;

  userTier?: UserTierId;
  userTierName?: string;
  paidTier?: GeminiUserTier;

  constructor(
    providerId: string,
    modelId: string,
    apiKey: string,
    gcConfig?: Config,
  ) {
    this.#gcConfig = gcConfig;
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
    const functionCalls: any[] = [];
    let usageMetadata: any;
    let finishReason = 'STOP';

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
          if (part?.functionCall) functionCalls.push(part.functionCall);
        }
      }
      if (candidate?.finishReason) {
        finishReason = toGeminiFinishReason(candidate.finishReason);
      }
      if ((chunk as any).usageMetadata) {
        usageMetadata = (chunk as any).usageMetadata;
      }
    }

    return {
      candidates: [
        {
          content: { parts, role: 'model' },
          finishReason: finishReason as any,
          index: 0,
        },
      ],
      usageMetadata,
      ...(functionCalls.length > 0 ? { functionCalls } : {}),
    } as unknown as GenerateContentResponse;
  }

  generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
    _role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    return Promise.resolve(this.#doStream(request, userPromptId));
  }

  async *#doStream(
    request: GenerateContentParameters,
    userPromptId: string,
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
    let tools: Array<{
      type: string;
      function: { name: string; description: string; parameters: unknown };
    }>;
    try {
      tools = this.#convertTools((request as any).config?.tools ?? []);
    } catch (err) {
      // Fail closed BEFORE any network/HTTP usage: a structurally invalid
      // tool schema must never reach a provider. Never expose credentials,
      // tokens, prompt contents, or file contents in this message.
      if (err instanceof InvalidToolSchemaError) {
        debugLogger.error('Refusing to send malformed tool schema:', err);
        yield this.#errorChunk(err.message);
        return;
      }
      throw err;
    }
    const systemPrompt = this.#extractSystemPrompt(request);
    const requestConfig = (request as any).config ?? {};
    const responseFormat = this.#buildResponseFormat(requestConfig);
    const reasoningEffort = this.#resolveReasoningEffort(
      requestConfig.thinkingConfig?.thinkingLevel,
    );
    const toolChoice = this.#convertToolChoice(requestConfig.toolConfig);

    // Look up the full model from the registry to get baseUrl and other metadata.
    // The registry's OMP catalog carries the provider-specific base URL
    // (e.g. https://integrate.api.nvidia.com/v1 for NVIDIA).
    // Without this lookup, the transport falls back to https://api.openai.com/v1.
    let registryModel: Record<string, any> | undefined;
    try {
      const registry = plumbModule.getPlumbModelRegistry?.();
      if (registry) {
        registryModel = registry.findModel(this.#providerId, this.#modelId);
        // Dynamic local models are persisted in the provider-scoped model
        // cache. A fresh process has an empty in-memory registry, so hydrate
        // that cache before request #1 instead of falling back to a bare
        // OpenAI model pointed at api.openai.com.
        if (!registryModel) {
          registry.loadCache?.(this.#providerId);
          registryModel = registry.findModel(this.#providerId, this.#modelId);
        }
      }
    } catch {
      // Registry/cache lookup failure is handled by the fail-closed check
      // below. Only configured local endpoints may be reconstructed safely.
    }

    // `this.#providerId` is the PLUMB presentation id (e.g. "antigravity");
    // transports key branching (isAntigravity, credential resolution) on the
    // canonical OMP id (e.g. "google-antigravity") that `registryModel.provider`
    // already carries via the catalog projection. Overwriting it with the raw
    // presentation id here desyncs normal chat from that canonical id while
    // diagnostics/probes construct it correctly, silently downgrading the
    // request envelope. Resolve the alias so both paths agree.
    const resolvedProviderId =
      (registryModel as any)?.provider ??
      plumbModule.resolveProviderAlias?.(this.#providerId) ??
      this.#providerId;

    // If a local server is temporarily unavailable during cold start, its
    // persisted provider endpoint still has enough information to route the
    // selected wire model safely. This is deliberately local-only: unknown
    // providers/dialects must continue to fail loudly in plumbModelStream.
    const localDefinition = plumbModule.getLocalProviderEndpointDefinition?.(
      this.#providerId,
    );
    const localBaseUrl = localDefinition
      ? plumbModule.resolveLocalProviderBaseUrl?.(this.#providerId)
      : undefined;

    if (!registryModel && !localDefinition) {
      yield this.#errorChunk(
        `MODEL_NOT_REGISTERED: '${this.#providerId}/${this.#modelId}' has no hydrated model descriptor. Reconfigure the provider or refresh its models before retrying.`,
      );
      return;
    }

    const model: Record<string, any> = {
      // Start with registry model if available (carries baseUrl, api, contextWindow, etc.)
      ...(registryModel ?? {}),
      // Always override with the explicit selection to prevent model ID prefix
      // inference from replacing the routing provider.
      id: this.#modelId,
      provider: resolvedProviderId,
      api: (registryModel as any)?.api ?? localDefinition?.api,
      ...((registryModel as any)?.baseUrl || localBaseUrl
        ? { baseUrl: (registryModel as any)?.baseUrl ?? localBaseUrl }
        : {}),
      contextWindow: (registryModel as any)?.contextWindow ?? 200000,
      maxTokens: (registryModel as any)?.maxTokens ?? 65536,
      reasoning: (registryModel as any)?.reasoning ?? true,
      input: (registryModel as any)?.input ?? 'text',
    };

    // Feed the real per-model contextWindow into packages/core's own
    // client-side token-budget bookkeeping (compaction threshold, overflow
    // check, tool-output truncation) -- see tokenLimits.ts. Without this,
    // that bookkeeping silently falls back to a Gemini-only default for
    // every non-Gemini model (Claude Subscription, OpenCode, Antigravity,
    // ...), letting the client send/keep far more history than the model's
    // real window actually allows. Keyed by this exact model id, so
    // switching models never bleeds one model's limit onto another.
    const realContextWindow = (registryModel as any)?.contextWindow;
    recordPlumbModelContextWindow(this.#modelId, realContextWindow);

    // Keep Config's tool-capability authority (read by getCoreSystemPrompt /
    // getEffectiveToolsAdvertisable and by the wire-level gate in
    // resolveAdvertisedTools) in sync with what the registry actually
    // resolved for this exact provider+model on every turn — not just at
    // selection time — so a capability that only becomes known after a
    // model-cache refresh (or a provider/model switch the UI layer didn't
    // pre-warm) still self-corrects before the next system-prompt render.
    this.#gcConfig?.setActiveModelToolsCapability?.(
      (model as any).toolsSupported,
      (model as any).toolsCapabilitySource ?? 'UNKNOWN',
    );
    if (!(typeof realContextWindow === 'number' && realContextWindow > 0)) {
      // The registry itself has no real contextWindow for this exact model
      // id (e.g. a Claude Subscription generic alias with no pinned
      // reference match) -- mark it explicitly UNKNOWN rather than leaving
      // tokenLimit() to silently fall back to a Gemini-only guess that a
      // UI surface could mistake for this model's real limit.
      recordPlumbModelContextWindowUnknown(this.#modelId);
    }

    const abortSignal = (request as any).config?.abortSignal as
      | AbortSignal
      | undefined;

    // Claude Subscription tool authority (PLUMB_CORE_TOOL_SCHEDULER): only
    // this transport's model actually needs a caller-supplied executor —
    // every other transport's tool calls are surfaced as ordinary
    // functionCall chunks (below) and executed by this class's own caller
    // (the normal Gemini agent loop / CoreToolScheduler), exactly as
    // before. Requires a real Config (always present in production; may be
    // absent in unit tests that construct this class directly) and a real
    // AbortSignal to bind tool-call cancellation to this turn. Imported
    // dynamically (not at module top level) — claudeSubscriptionToolBridge.ts
    // pulls in the full Scheduler subsystem, which every other
    // PlumbContentGenerator consumer/test has no reason to eagerly load.
    let toolExecutor:
      | ReturnType<
          typeof import('./claudeSubscriptionToolBridge.js').createClaudeSubscriptionToolExecutor
        >
      | undefined;
    if (
      model['api'] === 'claude-agent-sdk' &&
      tools.length > 0 &&
      this.#gcConfig &&
      abortSignal
    ) {
      const { createClaudeSubscriptionToolExecutor } = await import(
        './claudeSubscriptionToolBridge.js'
      );
      toolExecutor = createClaudeSubscriptionToolExecutor(
        this.#gcConfig,
        userPromptId,
        abortSignal,
      );
    }

    try {
      const stream = plumbModule.plumbModelStream({
        model,
        messages,
        tools,
        apiKey: this.#apiKey,
        signal: abortSignal,
        toolExecutor,
        systemPrompt,
        maxTokens: requestConfig.maxOutputTokens,
        temperature: requestConfig.temperature,
        responseFormat,
        reasoningEffort,
        toolChoice,
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
                  id: event.toolCall.id,
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
                  finishReason: toGeminiFinishReason(event.finishReason),
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
    const functionCall = part['functionCall'];
    return {
      candidates: [
        {
          content: { parts: [part], role: 'model' },
          finishReason: undefined as any,
          index: 0,
        },
      ],
      ...(functionCall ? { functionCalls: [functionCall] } : {}),
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

  #buildResponseFormat(config: Record<string, any>):
    | { type: 'json_object' }
    | {
        type: 'json_schema';
        json_schema: {
          name: string;
          strict: boolean;
          schema: Record<string, unknown>;
        };
      }
    | undefined {
    if (config['responseMimeType'] !== 'application/json') return undefined;
    const responseSchema = config['responseSchema'];
    if (isRecord(responseSchema)) {
      return {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          strict: true,
          schema: responseSchema,
        },
      };
    }
    return { type: 'json_object' };
  }

  #resolveReasoningEffort(
    thinkingLevel: unknown,
  ): 'minimal' | 'low' | 'medium' | 'high' | undefined {
    if (typeof thinkingLevel !== 'string') return undefined;
    const normalized = thinkingLevel.toLowerCase();
    if (
      normalized === 'minimal' ||
      normalized === 'low' ||
      normalized === 'medium' ||
      normalized === 'high'
    ) {
      return normalized;
    }
    return undefined;
  }

  /**
   * Converts Gemini-shaped history (`request.contents`, the SDK type
   * PlumbContentGenerator implements ContentGenerator against) into
   * PlumbMessage[] for the provider transport.
   *
   * A tool-call/tool-result turn MUST preserve the real functionCall.id /
   * functionResponse.id correlation (see turn.ts's handlePendingFunctionCall,
   * which assigns a synthetic id when the model omits one and mutates it
   * back onto the same object the app's history stores) and MUST NOT
   * collapse a functionCall into placeholder text — every dialect's own
   * message builder (transports/streaming.ts) reconstructs its real wire
   * shape (OpenAI tool_calls[]/tool role, Anthropic tool_use/tool_result
   * blocks, Gemini functionCall/functionResponse parts) from these
   * structured PlumbContentPart entries; flattening here silently breaks
   * multi-turn tool use for every one of them.
   */
  #convertMessages(contents: any[]): Array<{
    role: string;
    content: unknown;
    name?: string;
    toolCallId?: string;
  }> {
    const result: Array<{
      role: string;
      content: unknown;
      name?: string;
      toolCallId?: string;
    }> = [];
    if (!Array.isArray(contents)) return result;
    for (const content of contents) {
      if (!content.parts) continue;
      const role =
        content.role === 'model' ? 'assistant' : (content.role ?? 'user');

      // One Gemini Content entry can carry multiple functionResponse parts
      // (parallel tool calls) — each becomes its own PlumbMessage (the
      // 'tool' role is inherently one-result-per-message across every
      // dialect this app supports).
      const functionResponseParts = content.parts.filter((p: any) =>
        Boolean(p.functionResponse),
      );
      if (functionResponseParts.length > 0) {
        for (const part of functionResponseParts) {
          const fr = part.functionResponse;
          const id = fr.id ?? fr.name;
          result.push({
            role: 'tool',
            toolCallId: id,
            name: fr.name,
            content: [
              {
                type: 'tool_result',
                id,
                name: fr.name ?? '',
                result: JSON.stringify(fr.response ?? {}),
              },
            ],
          });
        }
        continue;
      }

      // Text + functionCall parts share one turn (a real assistant message
      // can say "Let me check that." and then call a tool in the same
      // turn) — merge them into one PlumbMessage's structured content
      // array rather than splitting into separate messages.
      const structuredParts: unknown[] = [];
      for (const part of content.parts) {
        if (part.text) {
          structuredParts.push({ type: 'text', text: part.text });
        } else if (part.inlineData?.data) {
          const mimeType = part.inlineData.mimeType ?? 'image/png';
          structuredParts.push({
            type: 'image',
            imageUrl: `data:${mimeType};base64,${part.inlineData.data}`,
            mimeType,
          });
        } else if (part.fileData?.fileUri) {
          structuredParts.push({
            type: 'image',
            imageUrl: part.fileData.fileUri,
            mimeType: part.fileData.mimeType,
          });
        } else if (part.functionCall) {
          const fc = part.functionCall;
          structuredParts.push({
            type: 'tool_call',
            id: fc.id ?? fc.name,
            name: fc.name ?? 'unknown',
            arguments: JSON.stringify(fc.args ?? {}),
          });
        }
      }
      if (structuredParts.length === 0) continue;

      // Plain single-text turns stay a bare string — every builder accepts
      // both shapes, and this keeps existing non-tool conversations
      // byte-identical to before this fix.
      const onlyText =
        structuredParts.length === 1 &&
        (structuredParts[0] as { type: string }).type === 'text';
      result.push({
        role,
        content: onlyText
          ? (structuredParts[0] as { text: string }).text
          : structuredParts,
      });
    }
    return result;
  }

  /**
   * Converts the canonical `FunctionDeclaration[]` this provider-neutral
   * layer receives into the OpenAI-shaped tool array every downstream
   * dialect transport (openAICompatibleStream, anthropicMessagesStream,
   * streamClaudeSubscription, ...) expects.
   *
   * Every real PLUMB tool declares its schema on `parametersJsonSchema`
   * (see packages/core/src/tools/definitions/*.ts) -- `parameters` is a
   * *different*, mutually-exclusive legacy `@google/genai` field (a
   * Schema-enum shape, not JSON Schema) that PLUMB's own tool
   * declarations never populate. Reading `fd.parameters` here silently
   * collapsed every tool's real schema to `{}` (no `type`, no
   * `properties`) before it ever reached a provider -- the shared root
   * cause behind "schema must be type object, got type null" and
   * equivalent errors across every provider routed through this
   * generator (Claude Subscription, OpenCode Go/Zen, Antigravity,
   * Anthropic API, ...), not a Claude-specific bug.
   *
   * Fails closed (throws InvalidToolSchemaError, never partially built)
   * when a tool's canonical schema doesn't satisfy
   * validateCanonicalToolSchema -- the caller must not send the request.
   */
  #convertTools(tools: any[]): Array<{
    type: string;
    function: { name: string; description: string; parameters: unknown };
  }> {
    if (!Array.isArray(tools) || tools.length === 0) return [];
    return tools.flatMap((t: any) => {
      const decls = t.functionDeclarations;
      if (!Array.isArray(decls)) return [];
      return decls.map((fd: any) => {
        const name = String(fd.name ?? '');
        // Explicit null is a malformed JSON Schema, not an absent no-args
        // declaration. Only genuinely absent/empty declarations may receive
        // the canonical no-argument schema.
        const rawSchema =
          fd.parametersJsonSchema !== undefined
            ? fd.parametersJsonSchema
            : fd.parameters;
        const parameters =
          rawSchema === undefined ||
          (isRecord(rawSchema) && Object.keys(rawSchema).length === 0)
            ? CANONICAL_NO_ARGS_SCHEMA
            : rawSchema;
        const validation = validateCanonicalToolSchema(parameters, name);
        if (!validation.valid) {
          throw new InvalidToolSchemaError(validation);
        }
        return {
          type: 'function' as const,
          function: {
            name,
            description: String(fd.description ?? ''),
            parameters,
          },
        };
      });
    });
  }

  #extractSystemPrompt(request: GenerateContentParameters): string | undefined {
    const instruction = (request as any).config?.systemInstruction as
      | { parts?: Array<{ text?: string }> }
      | undefined;
    if (!instruction?.parts) return undefined;
    return instruction.parts.map((p) => p.text ?? '').join('\n') || undefined;
  }

  #convertToolChoice(
    toolConfig: any,
  ):
    | { mode: 'auto' | 'required' | 'none' }
    | { mode: 'named'; name: string }
    | undefined {
    const functionConfig = toolConfig?.functionCallingConfig ?? toolConfig;
    const mode = String(functionConfig?.mode ?? '').toUpperCase();
    const allowed = functionConfig?.allowedFunctionNames;
    if (mode === 'NONE') return { mode: 'none' };
    if (mode === 'AUTO' || mode === 'VALIDATED') return { mode: 'auto' };
    if (mode === 'ANY') {
      return Array.isArray(allowed) && allowed.length === 1
        ? { mode: 'named', name: String(allowed[0]) }
        : { mode: 'required' };
    }
    return undefined;
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

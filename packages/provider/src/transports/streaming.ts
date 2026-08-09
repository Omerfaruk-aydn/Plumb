/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * OMP-derived streaming transport adapter for PLUMB (THIN PLUMB UI FACADE).
 *
 * The event-stream normalization lifecycle is the responsibility of the
 * imported OMP runtime (`omp-ai/utils/event-stream.ts`); the per-provider
 * streaming dispatch is governed by `omp-ai/stream.ts`. This module keeps
 * the PLUMB `PlumbStreamEvent` shape and the transport-registry surface.
 * Upstream source: https://github.com/can1357/oh-my-pi.git
 * Upstream SHA: 4df68d60438423b384b2b47fb3d6835641624757
 * Upstream source: packages/ai/src/stream.ts
 * Upstream source: packages/ai/src/utils/event-stream.ts
 * Upstream license: MIT (c) 2025 Mario Zechner, (c) 2025-2026 Can Bölük
 */

import {
  type PlumbModel,
  type PlumbStreamEvent,
  type PlumbStreamOptions,
  type PlumbKnownApi,
} from '../types.js';
import { EventStream } from '../omp-ai/utils/event-stream.js';
import {
  classifyGenericHttpError,
  classifyAnthropicHttpError,
  classifyAnthropicSseErrorType,
  classifyGoogleHttpError,
} from './errorClassification.js';
import { streamClaudeSubscription } from './claudeSubscription.js';
import { streamWatsonx } from './watsonx.js';
import { streamOciGenaiResponses } from './ociGenaiResponses.js';
import { streamBedrockConverse } from './bedrock.js';

// ─── Safe Antigravity request/response tracing ────────────────────────
//
// Opt-in only (PLUMB_ANTIGRAVITY_TRACE_SAFE=1), off by default, zero
// behavior change when unset. Exists so a real normal-chat 404 can be
// compared against a real `--test-antigravity-route` 200 at the exact same
// code path both go through (buildAntigravityRequest / this fetch call) —
// never a token, project ID, or message/tool content.

function antigravityTraceEnabled(): boolean {
  return process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE'] === '1';
}

function makeAntigravityTraceId(): string {
  return `ag-${Math.random().toString(36).slice(2, 10)}`;
}

function traceAntigravity(line: string): void {
  if (!antigravityTraceEnabled()) return;
  process.stderr.write(`[antigravity-trace] ${line}\n`);
}

/**
 * Safe (non-secret) summary of a built Antigravity request descriptor,
 * shared by the trace facility here and (structurally mirrored) by the
 * `--diagnose-antigravity-route` CLI diagnostic — same fields, same
 * omissions. Never includes a token, project ID value, or message/tool
 * content.
 */
function describeAntigravityRequestSafely(
  descriptor: AntigravityRequestDescriptor,
): string[] {
  const lines: string[] = [];
  try {
    const url = new URL(descriptor.url);
    lines.push(`request.origin: ${url.origin}`);
    lines.push(`request.pathname: ${url.pathname}`);
    lines.push(
      `request.query.keys: ${[...url.searchParams.keys()].join(',') || '(none)'}`,
    );
  } catch {
    lines.push('request.origin: (unparseable)');
  }
  lines.push(
    `request.headers.names: ${Object.keys(descriptor.headers).join(',')}`,
  );
  lines.push(
    `request.authorization.present: ${descriptor.headers['Authorization'] !== undefined}`,
  );
  const body = descriptor.body;
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    lines.push(`request.body.topLevelKeys: ${Object.keys(rec).join(',')}`);
    lines.push(`request.body.project.present: ${'project' in rec}`);
    const bodyModel = rec['model'];
    lines.push(
      `request.body.model: ${typeof bodyModel === 'string' ? bodyModel : '(unknown)'}`,
    );
    lines.push(`request.body.requestId.present: ${'requestId' in rec}`);
    const inner = rec['request'];
    lines.push(`request.body.request.present: ${'request' in rec}`);
    if (inner && typeof inner === 'object') {
      const innerRec = inner as Record<string, unknown>;
      lines.push(`request.body.sessionId.present: ${'sessionId' in innerRec}`);
      lines.push(`request.body.labels.present: ${'labels' in innerRec}`);
      const contents = innerRec['contents'];
      lines.push(
        `request.contents.count: ${Array.isArray(contents) ? contents.length : 0}`,
      );
      const tools = innerRec['tools'];
      lines.push(
        `request.tools.count: ${Array.isArray(tools) ? tools.length : 0}`,
      );
      lines.push(
        `request.systemInstruction.present: ${'systemInstruction' in innerRec}`,
      );
    }
    lines.push(
      `request.body.userAgent: ${String(rec['userAgent'] ?? '(absent)')}`,
    );
    lines.push(
      `request.body.requestType: ${String(rec['requestType'] ?? '(absent)')}`,
    );
  }
  return lines;
}

// ─── Transport implementations ─────────────────────────────────────────

type PlumbTransportFactory = (
  options: PlumbStreamOptions,
) => AsyncGenerator<PlumbStreamEvent>;

const transportFactories = new Map<PlumbKnownApi, PlumbTransportFactory>();

/** Register a streaming transport for an API type. */
export function registerPlumbTransport(
  api: PlumbKnownApi,
  factory: PlumbTransportFactory,
): void {
  transportFactories.set(api, factory);
}

/** Check if a transport is registered for an API type. */
export function hasPlumbTransport(api: PlumbKnownApi): boolean {
  return transportFactories.has(api);
}

// ─── OpenAI-compatible streaming ───────────────────────────────────────

/**
 * Generic OpenAI-compatible streaming transport.
 * Works with any provider that exposes a `/v1/chat/completions` endpoint
 * with SSE streaming. This is the fallback for all OpenAI-compatible APIs
 * (OpenAI, OpenRouter, Together, Fireworks, Groq, DeepSeek, Mistral, etc.)
 */
async function* openAICompatibleStream(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const {
    model,
    messages,
    tools,
    apiKey,
    signal,
    maxTokens,
    temperature,
    systemPrompt,
  } = options;

  const baseUrl = model.baseUrl ?? 'https://api.openai.com/v1';
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body: Record<string, unknown> = {
    model: model.requestModelId ?? model.id,
    messages: buildOpenAIMessages(messages, systemPrompt),
    stream: true,
    stream_options: { include_usage: true },
  };

  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: t.function,
    }));
  }
  if (maxTokens) body.max_tokens = maxTokens;
  if (temperature !== undefined && temperature >= 0)
    body.temperature = temperature;

  // A missing/empty credential must fail loudly here — falling through
  // silently produces `Authorization: Bearer ` (no token), which providers
  // like GitHub Copilot reject as "Authorization header is badly formatted"
  // instead of the actual problem (no resolved credential for this provider).
  if (!apiKey) {
    yield {
      type: 'error',
      error: {
        code: 'MISSING_CREDENTIAL',
        message: `No credential available for provider: ${model.provider}. Sign in again via /login ${model.provider}.`,
      },
    };
    return;
  }

  // Azure OpenAI uses api-key header; all others use Authorization: Bearer.
  // The model.headers field can carry provider-specific headers.
  const authHeaders: Record<string, string> = {};
  const isAzure =
    model.provider === 'azure' ||
    (model.baseUrl ?? '').includes('.openai.azure.com');
  if (isAzure) {
    authHeaders['api-key'] = apiKey;
  } else {
    authHeaders['Authorization'] = `Bearer ${apiKey}`;
  }

  // Merge any provider-specific headers from the model.
  if (model.headers) {
    Object.assign(authHeaders, model.headers);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    yield {
      type: 'error',
      error: { code: 'NETWORK_ERROR', message: (err as Error).message },
    };
    return;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    const classified = classifyGenericHttpError(response.status, errorText);
    yield {
      type: 'error',
      error: classified,
    };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield {
      type: 'error',
      error: { code: 'NO_RESPONSE_BODY', message: 'No response body' },
    };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          const delta = choice?.delta;

          if (delta?.content) {
            yield { type: 'text', text: delta.content };
          }

          if (delta?.reasoning_content || delta?.thinking) {
            yield {
              type: 'thinking',
              thinkingText: delta.reasoning_content || delta.thinking,
            };
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function) {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: tc.id ?? `call_${tc.index ?? 0}`,
                    name: tc.function.name ?? '',
                    arguments: tc.function.arguments ?? '',
                  },
                };
              }
            }
          }

          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }

          if (parsed.usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: parsed.usage.prompt_tokens ?? 0,
                outputTokens: parsed.usage.completion_tokens ?? 0,
                reasoningTokens:
                  parsed.usage.completion_tokens_details?.reasoning_tokens,
                totalTokens: parsed.usage.total_tokens ?? 0,
              },
            };
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Graceful cancellation
    } else {
      yield {
        type: 'error',
        error: { code: 'STREAM_ERROR', message: (err as Error).message },
      };
      return;
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: 'done', finishReason };
}

// ─── Anthropic Messages streaming ──────────────────────────────────────

async function* anthropicMessagesStream(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const {
    model,
    messages,
    tools,
    apiKey,
    signal,
    maxTokens,
    temperature,
    systemPrompt,
  } = options;

  const baseUrl = model.baseUrl ?? 'https://api.anthropic.com';
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;

  const systemMessages: unknown[] = [];
  const chatMessages: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessages.push({
        type: 'text',
        text: typeof msg.content === 'string' ? msg.content : '',
      });
    } else {
      chatMessages.push(buildAnthropicMessage(msg));
    }
  }

  // Apply thinking config from model
  const thinkingConfig = model.thinking;
  const hasThinking =
    thinkingConfig?.supportedEfforts?.length &&
    thinkingConfig.supportedEfforts.length > 0;

  const body: Record<string, unknown> = {
    model: model.requestModelId ?? model.id,
    messages: chatMessages,
    stream: true,
    max_tokens: maxTokens ?? model.maxTokens ?? 4096,
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  } else if (systemMessages.length > 0) {
    body.system = systemMessages;
  }

  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  if (hasThinking) {
    const budget = thinkingConfig!.effortBudgets?.['high'] ?? 16000;
    body.thinking = { type: 'enabled', budget_tokens: budget };
  }

  if (temperature !== undefined) body.temperature = temperature;

  // A missing/empty credential must fail loudly here — sending the request
  // with no auth header at all just produces a less specific upstream error
  // ("missing required Authorization header") for the same underlying
  // problem (no resolved credential for this provider).
  if (!apiKey) {
    yield {
      type: 'error',
      error: {
        code: 'MISSING_CREDENTIAL',
        message: `No credential available for provider: ${model.provider}. Sign in again via /login ${model.provider}.`,
      },
    };
    return;
  }

  // GitHub Copilot's Anthropic-compatible proxy requires Authorization:
  // Bearer regardless of credential kind — it does not accept x-api-key
  // (confirmed: sending x-api-key alone produces "missing required
  // Authorization header" from Copilot's endpoint). Native Anthropic API
  // endpoints accept both; x-api-key remains the default there.
  // The model.headers field can carry provider-specific headers
  // (e.g. anthropic-beta, anthropic-dangerous-direct-browser-access).
  const authHeaders: Record<string, string> = {};
  if (model.provider === 'github-copilot') {
    authHeaders['Authorization'] = `Bearer ${apiKey}`;
  } else {
    authHeaders['x-api-key'] = apiKey;
  }

  // Merge any provider-specific headers from the model (set by OMP catalog
  // or by PlumbContentGenerator when it resolves the full model from registry).
  if (model.headers) {
    Object.assign(authHeaders, model.headers);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...authHeaders,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    yield {
      type: 'error',
      error: { code: 'NETWORK_ERROR', message: (err as Error).message },
    };
    return;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    yield {
      type: 'error',
      error: classifyAnthropicHttpError(response.status, errorText),
    };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield {
      type: 'error',
      error: { code: 'NO_RESPONSE_BODY', message: 'No response body' },
    };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);

        try {
          const parsed = JSON.parse(data);

          switch (parsed.type) {
            case 'content_block_start': {
              const block = parsed.content_block;
              if (block.type === 'tool_use') {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: block.id,
                    name: block.name,
                    arguments: '',
                  },
                };
              }
              break;
            }
            case 'content_block_delta': {
              const delta = parsed.delta;
              if (delta.type === 'text_delta') {
                yield { type: 'text', text: delta.text };
              } else if (delta.type === 'input_json_delta') {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: '',
                    name: '',
                    arguments: delta.partial_json,
                  },
                };
              } else if (delta.type === 'thinking_delta') {
                yield { type: 'thinking', thinkingText: delta.thinking };
              } else if (delta.type === 'signature_delta') {
                // Signature is internal bookkeeping
              }
              break;
            }
            case 'message_delta': {
              if (parsed.delta?.stop_reason) {
                finishReason = parsed.delta.stop_reason;
              }
              if (parsed.usage) {
                outputTokens = parsed.usage.output_tokens ?? outputTokens;
                inputTokens = parsed.usage.input_tokens ?? inputTokens;
                yield {
                  type: 'usage',
                  usage: {
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                  },
                };
              }
              break;
            }
            case 'message_start': {
              if (parsed.message?.usage) {
                inputTokens = parsed.message.usage.input_tokens ?? 0;
              }
              break;
            }
            case 'error': {
              const sseMessage =
                parsed.error?.message ?? 'Unknown provider error';
              const canonical = classifyAnthropicSseErrorType(
                parsed.error?.type,
                sseMessage,
              );
              yield {
                type: 'error',
                error: {
                  // Keep the raw documented type as the code when it isn't
                  // one of the currently-mapped values — still a real,
                  // Anthropic-reported classification, not a guess.
                  code: canonical ?? parsed.error?.type ?? 'PROVIDER_ERROR',
                  message: sseMessage,
                },
              };
              return;
            }
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Graceful cancellation
    } else {
      yield {
        type: 'error',
        error: { code: 'STREAM_ERROR', message: (err as Error).message },
      };
      return;
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: 'done', finishReason };
}

// ─── Google Cloud Code Assist streaming (google-gemini-cli / google-antigravity) ──
//
// Real production defect (two rounds): this API family (OAuth-only —
// google-gemini-cli and google-antigravity share it, per the pinned OMP
// implementation in omp-ai/providers/google-gemini-cli.ts) was previously
// routed through googleGenerativeAiStream below, a public-Gemini-API client
// (`?key=<token>`), leaking the OAuth token into the URL and 404ing. A first
// fix pointed the URL/auth at the real endpoint but still built the request
// BODY by hand — missing the envelope fields
// (requestId/sessionId/labels/userAgent/requestType) that
// buildAntigravityRequestEnvelope (private, called from the exported
// buildRequest) generates to mirror the real antigravity/hub client, and
// that Google's backend evidently requires to route the request at all
// (still 404s without them). Delegating to the real exported buildRequest
// here — rather than hand-copying its private envelope logic — makes this
// call byte-identical to the pinned reference by construction, not by
// differential comparison.
//
// Credential note: this API needs both the OAuth access token AND the
// project id. PlumbStreamOptions.apiKey is a single flat string (the
// contract every other transport in this file shares — Copilot, NVIDIA,
// etc. — and PlumbSecureCredentialStore.getApiKey() only ever returns a
// bare access token, dropping projectId). Rather than widen that shared
// contract for one provider family, this reads the full PlumbOAuthCredential
// directly from the canonical PlumbProviderRegistry.
export interface AntigravityRequestDescriptor {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export type AntigravityRequestResult =
  | { ok: true; descriptor: AntigravityRequestDescriptor }
  | { ok: false; error: PlumbStreamEvent };

/**
 * Builds the exact request (URL/headers/body) a real google-gemini-cli /
 * google-antigravity chat turn sends — used by BOTH normal chat
 * (googleCloudCodeAssistStream below) and the `plumb --diagnose-antigravity-route`
 * / `--test-antigravity-route` CLI diagnostics, so the two can never silently
 * diverge into "the diagnostic looks right but chat uses something else."
 * Never resolves with the raw accessToken/projectId anywhere but inside the
 * returned descriptor (which callers must sanitize before printing).
 */
export async function buildAntigravityRequest(
  options: PlumbStreamOptions,
  callerTraceId?: string,
): Promise<AntigravityRequestResult> {
  const { model, messages, tools, systemPrompt, maxTokens, temperature } =
    options;

  const source = options.traceSource ?? 'NORMAL_CHAT';
  const traceId = antigravityTraceEnabled()
    ? (callerTraceId ?? makeAntigravityTraceId())
    : null;
  if (traceId) {
    const { traceAntigravityRequestConstruction } = await import(
      './antigravityTrace.js'
    );
    traceAntigravityRequestConstruction({
      traceId,
      source,
      model,
      options,
      generatorInstance: options.generatorInstance,
    });
    for (const line of describeAntigravityRequestSafely({
      url: model.baseUrl ?? 'https://daily-cloudcode-pa.googleapis.com',
      headers: {},
      body: null,
    })) {
      traceAntigravity(`traceId=${traceId} ${line}`);
    }
  }

  const { resolvePlumbProviderId } = await import('../catalog/providers.js');
  const { resolveUsablePlumbCredential } = await import(
    '../auth/credential-resolver.js'
  );
  // `model.provider` on a catalog-projected PlumbModel carries the OMP
  // registry id (e.g. `google-antigravity`), but PlumbProviderRegistry
  // credential state is keyed by the PLUMB presentation id (`antigravity`)
  // that login/UI/settings use — resolve back to that id before lookup, or
  // this always misses and falls through to MISSING_CREDENTIAL even when a
  // valid credential is stored.
  const registryProviderId = resolvePlumbProviderId(model.provider);
  // Classifies the stored credential and — only when it is expired but a
  // refresh token is available — performs one silent refresh-token
  // exchange (never a new OAuth/login flow) before returning. Shared with
  // the `--diagnose-antigravity-route` / `--test-antigravity-route`
  // diagnostics so normal chat and diagnostics can never diverge here.
  const resolved = await resolveUsablePlumbCredential(registryProviderId);
  const credential = resolved.credential;

  if (!credential || !credential.access || !credential.projectId) {
    if (traceId) {
      const { traceAntigravityError } = await import('./antigravityTrace.js');
      traceAntigravityError({
        traceId,
        source,
        error: {
          code: 'MISSING_CREDENTIAL',
          message: `No credential available for provider: ${registryProviderId}`,
        },
      });
    }
    return {
      ok: false,
      error: {
        type: 'error',
        error: {
          code: 'MISSING_CREDENTIAL',
          message: `No credential available for provider: ${registryProviderId} (${resolved.classification}). Sign in again via /login ${registryProviderId}.`,
        },
      },
    };
  }
  const accessToken = credential.access;
  const projectId = credential.projectId;

  const gcli = await import('../omp-ai/providers/google-gemini-cli.js');
  const isAntigravity = model.provider === 'google-antigravity';

  // Minimal PLUMB -> OMP message/model/tool conversion. PlumbMessage/
  // PlumbModel/PlumbTool are already flatter than OMP's Message/Model/Tool
  // (PlumbContentGenerator itself only ever hands this transport plain
  // text-ish history — see #convertMessages in plumbContentGenerator.ts),
  // so this covers the real shape in play without inventing history this
  // transport was never given in the first place.
  const now = Date.now();
  const ompMessages: import('../omp-ai/types.js').Message[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    const text = typeof msg.content === 'string' ? msg.content : '';
    if (msg.role === 'user') {
      ompMessages.push({ role: 'user', content: text, timestamp: now });
    } else if (msg.role === 'assistant') {
      ompMessages.push({
        role: 'assistant',
        content: [{ type: 'text', text }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: now,
      } as unknown as import('../omp-ai/types.js').Message);
    } else if (msg.role === 'tool') {
      ompMessages.push({
        role: 'toolResult',
        toolCallId: msg.toolCallId ?? '',
        toolName: msg.name ?? '',
        content: [{ type: 'text', text }],
        isError: false,
      } as unknown as import('../omp-ai/types.js').Message);
    }
  }

  const context: import('../omp-ai/types.js').Context = {
    systemPrompt: systemPrompt ? [systemPrompt] : undefined,
    messages: ompMessages,
    tools: (tools ?? []).map(
      (t) =>
        ({
          name: t.function.name,
          description: t.function.description ?? '',
          parameters: t.function.parameters,
        }) as unknown as import('../omp-ai/types.js').Tool,
    ),
  };

  const ompModel = {
    id: model.id,
    requestModelId: model.requestModelId,
    name: model.name ?? model.id,
    api: 'google-gemini-cli',
    provider: model.provider,
    baseUrl: model.baseUrl ?? gcli.DEFAULT_ENDPOINT,
    reasoning: model.reasoning,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  } as unknown as import('../omp-ai/types.js').Model<'google-gemini-cli'>;

  let requestBody: unknown;
  try {
    requestBody = gcli.buildRequest(
      ompModel,
      context,
      projectId,
      { maxTokens, temperature },
      isAntigravity,
    );
  } catch (err) {
    if (traceId) {
      const { traceAntigravityError } = await import('./antigravityTrace.js');
      traceAntigravityError({
        traceId,
        source,
        error: {
          code: 'REQUEST_BUILD_FAILED',
          message: (err as Error).message,
        },
      });
    }
    return {
      ok: false,
      error: {
        type: 'error',
        error: {
          code: 'REQUEST_BUILD_FAILED',
          message: `Failed to build ${model.provider} request: ${(err as Error).message}`,
        },
      },
    };
  }

  const baseUrl = (model.baseUrl ?? gcli.DEFAULT_ENDPOINT).replace(/\/+$/, '');
  const url = `${baseUrl}/v1internal:streamGenerateContent?alt=sse`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (isAntigravity) {
    headers['User-Agent'] = gcli.getAntigravityUserAgent();
  }

  const descriptor = { url, headers, body: requestBody };
  return { ok: true, descriptor };
}

export interface SafeFieldViolation {
  field: string;
  description?: string;
}

export interface SafeGoogleErrorDetails {
  code?: number;
  status?: string;
  reason?: string;
  domain?: string;
  detailTypes: string[];
  fieldViolations: SafeFieldViolation[];
  safeMessage?: string;
}

function sanitizeSafeText(str: string, maxLen = 200): string {
  if (!str) return '';
  return str
    .replace(/ya29\.[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, '[REDACTED_BEARER]')
    .replace(/projects\/[A-Za-z0-9._-]+/g, 'projects/[REDACTED]')
    .slice(0, maxLen);
}

function sanitizeSafeDescription(str: string): string {
  if (!str) return '';
  const sanitized = str
    .replace(/ya29\.[A-Za-z0-9_-]+/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, '[REDACTED_BEARER]')
    .replace(/projects\/[A-Za-z0-9._-]+/g, 'projects/[REDACTED]');
  return sanitized.length > 300 ? `${sanitized.slice(0, 300)}...` : sanitized;
}

export function extractSafeGoogleErrorDetails(
  bodyText: string,
): SafeGoogleErrorDetails {
  const result: SafeGoogleErrorDetails = {
    detailTypes: [],
    fieldViolations: [],
  };

  if (!bodyText || bodyText.trim().length === 0) return result;

  try {
    const parsed = JSON.parse(bodyText);
    const errObj = parsed?.error ?? parsed;
    if (!errObj || typeof errObj !== 'object') return result;

    if (typeof errObj.code === 'number') {
      result.code = errObj.code;
    }
    if (typeof errObj.status === 'string') {
      result.status = sanitizeSafeText(errObj.status, 100);
    }
    if (typeof errObj.message === 'string') {
      result.safeMessage = sanitizeSafeDescription(errObj.message);
    }

    if (Array.isArray(errObj.details)) {
      for (const d of errObj.details) {
        if (!d || typeof d !== 'object') continue;

        if (typeof d['@type'] === 'string') {
          const typeName = d['@type'].split('.').pop() ?? d['@type'];
          if (!result.detailTypes.includes(typeName)) {
            result.detailTypes.push(typeName);
          }
        }

        if (typeof d.reason === 'string') {
          result.reason = sanitizeSafeText(d.reason, 100);
        }
        if (typeof d.domain === 'string') {
          result.domain = sanitizeSafeText(d.domain, 100);
        }

        if (Array.isArray(d.fieldViolations)) {
          for (const fv of d.fieldViolations) {
            if (typeof fv?.field === 'string' && fv.field.length < 250) {
              const cleanField = sanitizeSafeText(fv.field, 250);
              const cleanDesc =
                typeof fv.description === 'string'
                  ? sanitizeSafeDescription(fv.description)
                  : undefined;
              result.fieldViolations.push({
                field: cleanField,
                ...(cleanDesc ? { description: cleanDesc } : {}),
              });
            }
          }
        }
      }
    }
  } catch {
    // Non-JSON response
  }

  return result;
}

export function formatSafeGoogleErrorSummary(
  details: SafeGoogleErrorDetails,
): string[] {
  const lines: string[] = [];
  if (details.status) {
    lines.push(`HTTP_ERROR_STATUS: ${details.status}`);
  }
  if (details.reason) {
    lines.push(`HTTP_ERROR_REASON: ${details.reason}`);
  }
  if (details.domain) {
    lines.push(`HTTP_ERROR_DOMAIN: ${details.domain}`);
  }
  if (details.fieldViolations.length > 0) {
    lines.push(`FIELD_VIOLATION_COUNT: ${details.fieldViolations.length}`);
    details.fieldViolations.forEach((fv, i) => {
      const descPart = fv.description ? `: ${fv.description}` : '';
      lines.push(`FIELD_VIOLATION_${i + 1}: ${fv.field}${descPart}`);
    });
  } else if (details.detailTypes.length > 0) {
    lines.push(`DETAIL_TYPES: ${details.detailTypes.join(', ')}`);
  }
  if (details.safeMessage) {
    lines.push(`HTTP_ERROR_MESSAGE: ${details.safeMessage}`);
  }
  return lines;
}

async function* googleCloudCodeAssistStream(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const source = options.traceSource ?? 'NORMAL_CHAT';
  const traceId = antigravityTraceEnabled() ? makeAntigravityTraceId() : null;

  const result = await buildAntigravityRequest(options, traceId ?? undefined);
  if (!result.ok) {
    if (traceId) {
      traceAntigravity(
        `traceId=${traceId} build.result=FAILED code=${result.error.error?.code ?? '(unknown)'}`,
      );
    }
    yield result.error;
    return;
  }
  const { url, headers, body } = result.descriptor;

  if (traceId) {
    const { traceAntigravityFinalHttpRequest } = await import(
      './antigravityTrace.js'
    );
    traceAntigravityFinalHttpRequest({
      traceId,
      source,
      model: options.model,
      descriptor: result.descriptor,
      options,
      generatorInstance: options.generatorInstance,
    });
    for (const line of describeAntigravityRequestSafely(result.descriptor)) {
      traceAntigravity(`traceId=${traceId} ${line}`);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err) {
    if (traceId) {
      const { traceAntigravityError } = await import('./antigravityTrace.js');
      traceAntigravityError({
        traceId,
        source,
        error: {
          code: 'REQUEST_FAILED',
          message: (err as Error).message,
        },
      });
      traceAntigravity(
        `traceId=${traceId} request.attempted=true fetch.threw=true`,
      );
    }
    if ((err as Error).name === 'AbortError') {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    yield {
      type: 'error',
      error: { code: 'REQUEST_FAILED', message: (err as Error).message },
    };
    return;
  }

  if (traceId) {
    const { traceAntigravityHttpResponse } = await import(
      './antigravityTrace.js'
    );
    traceAntigravityHttpResponse({
      traceId,
      source,
      response,
    });

    const traceHeaderNames = ['x-goog-trace-id', 'x-request-id', 'server'];
    const safeHeaders = traceHeaderNames
      .map((h) => `${h}=${response.headers.get(h) ?? '(absent)'}`)
      .join(' ');
    traceAntigravity(
      `traceId=${traceId} request.attempted=true HTTP.status=${response.status} HTTP.statusText=${response.statusText} HTTP.contentType=${response.headers.get('content-type') ?? '(none)'} ${safeHeaders}`,
    );
  }

  if (!response.ok) {
    let safeDetails: SafeGoogleErrorDetails | undefined;

    if (response.status >= 400 && response.status < 500) {
      try {
        const bodyText = await response.text();
        safeDetails = extractSafeGoogleErrorDetails(bodyText);
      } catch {
        // Ignored — non-JSON or unparseable 4xx response
      }
    }

    const safeStatus = safeDetails?.status;
    const safeReason = safeDetails?.reason;
    const firstViolation = safeDetails?.fieldViolations[0];
    const safeField = firstViolation
      ? `${firstViolation.field}${firstViolation.description ? `: ${firstViolation.description}` : ''}`
      : undefined;

    const code =
      response.status === 404
        ? 'ENDPOINT_NOT_FOUND'
        : safeStatus
          ? `HTTP_${response.status}_${safeStatus}`
          : `HTTP_${response.status}`;

    if (traceId) {
      traceAntigravity(
        `traceId=${traceId} http.status=${response.status} classification=${code} safeStatus=${safeStatus ?? '(none)'} safeReason=${safeReason ?? '(none)'} safeField=${safeField ?? '(none)'}`,
      );
    }

    const extraDetail = [safeStatus, safeReason, safeField]
      .filter(Boolean)
      .join(' - ');
    yield {
      type: 'error',
      error: {
        code,
        message: `${options.model.provider} request failed (HTTP ${response.status}${extraDetail ? ` - ${extraDetail}` : ''}).`,
      },
    };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield {
      type: 'error',
      error: { code: 'NO_RESPONSE_BODY', message: 'No response body' },
    };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);

        try {
          const parsed = JSON.parse(data);
          // Cloud Code Assist wraps the Gemini response shape under
          // `.response` (vs the public API's flat shape) — the only
          // structural difference from googleGenerativeAiStream's parsing.
          const candidate = parsed.response?.candidates?.[0];
          if (!candidate) continue;

          if (candidate.finishReason) {
            finishReason = candidate.finishReason;
          }

          const parts = candidate.content?.parts ?? [];
          for (const part of parts) {
            if (part.text) {
              yield { type: 'text', text: part.text };
            } else if (part.thought) {
              yield { type: 'thinking', thinkingText: part.thought };
            } else if (part.functionCall) {
              yield {
                type: 'tool_call',
                toolCall: {
                  id: part.functionCall.name,
                  name: part.functionCall.name,
                  arguments: JSON.stringify(part.functionCall.args ?? {}),
                },
              };
            }
          }

          const usageMetadata = parsed.response?.usageMetadata;
          if (usageMetadata) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: usageMetadata.promptTokenCount ?? 0,
                outputTokens: usageMetadata.candidatesTokenCount ?? 0,
                reasoningTokens: usageMetadata.thoughtsTokenCount,
                totalTokens: usageMetadata.totalTokenCount ?? 0,
              },
            };
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Graceful cancellation
    } else {
      yield {
        type: 'error',
        error: { code: 'STREAM_ERROR', message: (err as Error).message },
      };
      return;
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: 'done', finishReason };
}

// ─── Google Gemini streaming ───────────────────────────────────────────

async function* googleGenerativeAiStream(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const { model, messages, tools, apiKey, signal, systemPrompt } = options;

  const baseUrl =
    model.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  const url = `${baseUrl.replace(/\/+$/, '')}/models/${model.requestModelId ?? model.id}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const contents = buildGeminiContents(messages);
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {},
  };

  if (systemPrompt) {
    body.systemInstruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  if (tools && tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
    ];
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    yield {
      type: 'error',
      error: { code: 'NETWORK_ERROR', message: (err as Error).message },
    };
    return;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    yield {
      type: 'error',
      error: classifyGoogleHttpError(
        response.status,
        errorText,
        extractSafeGoogleErrorDetails(errorText),
      ),
    };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield {
      type: 'error',
      error: { code: 'NO_RESPONSE_BODY', message: 'No response body' },
    };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);

        try {
          const parsed = JSON.parse(data);
          const candidate = parsed.candidates?.[0];
          if (!candidate) continue;

          if (candidate.finishReason) {
            finishReason = candidate.finishReason;
          }

          const parts = candidate.content?.parts ?? [];
          for (const part of parts) {
            if (part.text) {
              yield { type: 'text', text: part.text };
            } else if (part.thought) {
              yield { type: 'thinking', thinkingText: part.thought };
            } else if (part.functionCall) {
              yield {
                type: 'tool_call',
                toolCall: {
                  id: part.functionCall.name,
                  name: part.functionCall.name,
                  arguments: JSON.stringify(part.functionCall.args ?? {}),
                },
              };
            }
          }

          if (parsed.usageMetadata) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: parsed.usageMetadata.promptTokenCount ?? 0,
                outputTokens: parsed.usageMetadata.candidatesTokenCount ?? 0,
                reasoningTokens: parsed.usageMetadata.thoughtsTokenCount,
                totalTokens: parsed.usageMetadata.totalTokenCount ?? 0,
              },
            };
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Graceful cancellation
    } else {
      yield {
        type: 'error',
        error: { code: 'STREAM_ERROR', message: (err as Error).message },
      };
      return;
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: 'done', finishReason };
}

// ─── Ollama streaming ──────────────────────────────────────────────────

async function* ollamaCompatibleStream(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const {
    model,
    messages,
    tools,
    signal,
    systemPrompt,
    maxTokens,
    temperature,
  } = options;

  const baseUrl = model.baseUrl ?? 'http://127.0.0.1:11434/v1';
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body: Record<string, unknown> = {
    model: model.requestModelId ?? model.id,
    messages: buildOpenAIMessages(messages, systemPrompt),
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: t.function,
    }));
  }
  if (maxTokens) body.max_tokens = maxTokens;
  if (temperature !== undefined) body.temperature = temperature;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    yield {
      type: 'error',
      error: { code: 'REQUEST_FAILED', message: (err as Error).message },
    };
    return;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    yield {
      type: 'error',
      error: { code: `HTTP_${response.status}`, message: errorText },
    };
    return;
  }

  // Reuse OpenAI-compatible parser for Ollama
  const reader = response.body?.getReader();
  if (!reader) {
    yield {
      type: 'error',
      error: { code: 'NO_RESPONSE_BODY', message: 'No response body' },
    };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          const delta = choice?.delta;

          if (delta?.content) {
            yield { type: 'text', text: delta.content };
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function) {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: tc.id ?? `call_${tc.index ?? 0}`,
                    name: tc.function.name ?? '',
                    arguments: tc.function.arguments ?? '',
                  },
                };
              }
            }
          }

          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }

          if (parsed.usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: parsed.usage.prompt_tokens ?? 0,
                outputTokens: parsed.usage.completion_tokens ?? 0,
                totalTokens: parsed.usage.total_tokens ?? 0,
              },
            };
          }
        } catch {
          // Skip
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Graceful
    } else {
      yield {
        type: 'error',
        error: { code: 'STREAM_ERROR', message: (err as Error).message },
      };
      return;
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: 'done', finishReason };
}

// ─── Message builders ──────────────────────────────────────────────────
//
// PlumbMessage.content is `string | PlumbContentPart[]` — the array form
// carries structured `tool_call`/`tool_result`/`image`/`thinking` parts
// (see types.ts). Every dialect below MUST reconstruct its own real wire
// shape for a tool-call/tool-result turn (OpenAI: assistant.tool_calls[] +
// a separate `tool` message keyed by tool_call_id; Anthropic: assistant
// tool_use content blocks + a user message carrying tool_result blocks;
// Gemini: functionCall/functionResponse parts) — flattening these into
// plain text (the previous behavior) silently breaks multi-turn tool use:
// an OpenAI-compatible endpoint rejects a `tool` role message whose
// `tool_call_id` doesn't reference a real preceding `tool_calls[].id`.

interface AssistantContentSplit {
  /** `undefined` when the assistant turn had no text (tool-call-only). */
  text: string | undefined;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}

/**
 * Splits an assistant message's structured content into its text and
 * tool-call parts. Exported for reuse by transports whose wire format
 * needs the same split but a different final shape than
 * `buildOpenAIMessages` -- currently ociGenaiResponses.ts, whose Responses
 * API `input` array represents a prior tool call as its own flat
 * `function_call` item rather than Chat Completions' nested
 * `assistant.tool_calls[]` -- so there is exactly one place that walks
 * `PlumbContentPart[]` looking for tool-call parts, never a second copy.
 */
export function splitAssistantContent(
  content: PlumbStreamOptions['messages'][number]['content'],
): AssistantContentSplit {
  if (typeof content === 'string') {
    return { text: content || undefined, toolCalls: [] };
  }
  const textParts: string[] = [];
  const toolCalls: AssistantContentSplit['toolCalls'] = [];
  for (const part of content) {
    if (part.type === 'text' && part.text) {
      textParts.push(part.text);
    } else if (part.type === 'tool_call') {
      toolCalls.push({
        id: part.id,
        name: part.name,
        arguments: part.arguments,
      });
    }
    // 'thinking'/'image' parts are not resent as assistant history today —
    // no dialect here expects a prior turn's reasoning trace or an
    // assistant-authored image back on the wire.
  }
  return {
    text: textParts.length > 0 ? textParts.join('\n') : undefined,
    toolCalls,
  };
}

/**
 * Text-only projection of a message's content (system/tool-role turns).
 * Exported for reuse by ociGenaiResponses.ts -- see splitAssistantContent's
 * doc comment above.
 */
export function contentToText(
  content: PlumbStreamOptions['messages'][number]['content'],
): string {
  if (typeof content === 'string') return content;
  const pieces: string[] = [];
  for (const part of content) {
    if (part.type === 'text') pieces.push(part.text);
    else if (part.type === 'tool_result') pieces.push(part.result);
  }
  return pieces.join('\n');
}

/** OpenAI-shaped multimodal user content (falls back to a plain string). */
function buildOpenAIUserContent(
  content: PlumbStreamOptions['messages'][number]['content'],
): unknown {
  if (typeof content === 'string') return content;
  const hasImage = content.some((p) => p.type === 'image');
  if (!hasImage) return contentToText(content);
  const parts: unknown[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text });
    } else if (part.type === 'image') {
      parts.push({ type: 'image_url', image_url: { url: part.imageUrl } });
    }
  }
  return parts;
}

/**
 * Builds OpenAI Chat-Completions-shaped messages (assistant.tool_calls[],
 * tool.tool_call_id). Exported for reuse by transports whose wire format is
 * genuinely identical here — currently watsonx.ts, whose TextChatMessages
 * type is OpenAI-message-shaped (see the official SDK's messages.d.ts) —
 * so tool-call/tool-result history reconstruction has exactly one
 * implementation, never a second copy.
 */
export function buildOpenAIMessages(
  messages: PlumbStreamOptions['messages'],
  systemPrompt?: string,
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }
  for (const msg of messages) {
    if (msg.role === 'system') {
      result.push({ role: 'system', content: contentToText(msg.content) });
    } else if (msg.role === 'assistant') {
      const { text, toolCalls } = splitAssistantContent(msg.content);
      const entry: Record<string, unknown> = {
        role: 'assistant',
        content: text ?? null,
      };
      if (toolCalls.length > 0) {
        entry['tool_calls'] = toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      result.push(entry);
    } else if (msg.role === 'user') {
      result.push({
        role: 'user',
        content: buildOpenAIUserContent(msg.content),
      });
    } else if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        content: contentToText(msg.content),
        tool_call_id: msg.toolCallId,
      });
    }
  }
  return result;
}

function buildAnthropicMessage(
  msg: PlumbStreamOptions['messages'][number],
): Record<string, unknown> {
  if (msg.role === 'user') {
    return { role: 'user', content: msg.content };
  }
  if (msg.role === 'assistant') {
    if (typeof msg.content === 'string') {
      return { role: 'assistant', content: msg.content };
    }
    const blocks: unknown[] = [];
    for (const part of msg.content) {
      if (part.type === 'text' && part.text) {
        blocks.push({ type: 'text', text: part.text });
      } else if (part.type === 'tool_call') {
        blocks.push({
          type: 'tool_use',
          id: part.id,
          name: part.name,
          input: safeParseToolArguments(part.arguments),
        });
      }
    }
    return { role: 'assistant', content: blocks };
  }
  // Anthropic has no `tool` role — a tool result travels as a
  // `tool_result` content block inside a `user`-role message.
  if (msg.role === 'tool') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: contentToText(msg.content),
        },
      ],
    };
  }
  return {
    role: 'user',
    content: typeof msg.content === 'string' ? msg.content : '',
  };
}

function safeParseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function buildGeminiContents(
  messages: PlumbStreamOptions['messages'],
): Record<string, unknown>[] {
  const contents: Record<string, unknown>[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue; // Handled by systemInstruction

    if (msg.role === 'tool') {
      // Gemini returns tool results as functionResponse parts inside a
      // `user`-role Content, not a distinct role.
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: msg.toolCallId,
              name: msg.name ?? '',
              response: { result: contentToText(msg.content) },
            },
          },
        ],
      });
      continue;
    }

    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts: unknown[] = [];
    if (typeof msg.content === 'string') {
      if (msg.content) parts.push({ text: msg.content });
    } else {
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) {
          parts.push({ text: part.text });
        } else if (part.type === 'tool_call') {
          parts.push({
            functionCall: {
              id: part.id,
              name: part.name,
              args: safeParseToolArguments(part.arguments),
            },
          });
        } else if (part.type === 'image') {
          parts.push({
            inlineData: {
              mimeType: part.mimeType ?? 'image/png',
              data: part.imageUrl,
            },
          });
        }
      }
    }
    if (parts.length === 0) continue; // Never send an empty Content.
    contents.push({ role, parts });
  }
  return contents;
}

// ─── Dispatch ──────────────────────────────────────────────────────────

/**
 * Stream content from the selected model through its registered transport.
 * Falls back to OpenAI-compatible if no specific transport is registered.
 */
export async function* plumbModelStream(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const { model } = options;
  const api = model.api;

  // Try registered transport first
  const factory = transportFactories.get(api);
  if (factory) {
    yield* factory(options);
    return;
  }

  // Fall back based on API type
  switch (api) {
    case 'anthropic-messages':
      yield* anthropicMessagesStream(options);
      break;
    case 'google-gemini-cli':
      // Covers both google-gemini-cli and google-antigravity providers —
      // see googleCloudCodeAssistStream's comment for why this must not
      // share googleGenerativeAiStream (public-API-only) below.
      yield* googleCloudCodeAssistStream(options);
      break;
    case 'google-generative-ai':
    case 'google-vertex':
      yield* googleGenerativeAiStream(options);
      break;
    case 'ollama-chat':
      yield* ollamaCompatibleStream(options);
      break;
    case 'openai-completions':
    case 'openai-responses':
    case 'openrouter':
    case 'openai-codex-responses':
    case 'azure-openai-responses':
    case 'cursor-agent':
    case 'devin-agent':
    case 'gitlab-duo-agent':
    default:
      yield* openAICompatibleStream(options);
      break;
  }
}

// ─── Register built-in transports ──────────────────────────────────────

// OpenAI-compatible (covers most providers)
registerPlumbTransport('openai-completions', openAICompatibleStream);
registerPlumbTransport('openrouter', openAICompatibleStream);
registerPlumbTransport('openai-responses', openAICompatibleStream);

// Anthropic
registerPlumbTransport('anthropic-messages', anthropicMessagesStream);
registerPlumbTransport('claude-agent-sdk', streamClaudeSubscription);
registerPlumbTransport('watsonx-chat', streamWatsonx);
registerPlumbTransport('oci-openai-responses', streamOciGenaiResponses);
registerPlumbTransport('bedrock-converse-stream', streamBedrockConverse);

// Google
registerPlumbTransport('google-generative-ai', googleGenerativeAiStream);

// Local
registerPlumbTransport('ollama-chat', ollamaCompatibleStream);

// Passthrough for specialized APIs (handled by downstream code)
registerPlumbTransport('openai-codex-responses', openAICompatibleStream);
registerPlumbTransport('azure-openai-responses', openAICompatibleStream);
registerPlumbTransport('cursor-agent', openAICompatibleStream);
registerPlumbTransport('devin-agent', openAICompatibleStream);
registerPlumbTransport('gitlab-duo-agent', openAICompatibleStream);

// ─── OMP stream-normalization delegate ──────────────────────────────────

/** Create a PLUMB-typed event stream backed by the OMP normalization engine. */
export function createNormalizationStream(): EventStream<
  PlumbStreamEvent,
  void
> {
  return new EventStream<PlumbStreamEvent, void>(
    (e) => e.type === 'done' || e.type === 'error',
    () => undefined as void,
  );
}

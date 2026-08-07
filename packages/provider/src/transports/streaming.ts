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
              yield {
                type: 'error',
                error: {
                  code: parsed.error?.type ?? 'PROVIDER_ERROR',
                  message: parsed.error?.message ?? 'Unknown provider error',
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
// Real production defect: this API family (OAuth-only — google-gemini-cli
// and google-antigravity share it, per the pinned OMP implementation in
// omp-ai/providers/google-gemini-cli.ts) was previously routed through
// googleGenerativeAiStream below, which builds a public-Gemini-API request
// (`/models/<id>:streamGenerateContent?key=<apiKey>`). For an OAuth access
// token that put the token in the URL query string and hit a path that
// doesn't exist on the real Cloud Code Assist host, producing a Google HTML
// 404 with the token visible in the request. The real endpoint is a
// completely different API: `/v1internal:streamGenerateContent`,
// `Authorization: Bearer`, and a `{project, model, request: {...}}` request
// envelope — reusing the pinned OMP constants (DEFAULT_ENDPOINT,
// ANTIGRAVITY_DAILY_ENDPOINT, getAntigravityUserAgent) rather than
// re-deriving them, per the real google-gemini-cli.ts reference.
//
// Credential note: this API needs both the OAuth access token AND the
// project id. PlumbStreamOptions.apiKey is a single flat string (the
// contract every other transport in this file shares — Copilot, NVIDIA,
// etc. — and PlumbSecureCredentialStore.getApiKey() only ever returns a
// bare access token, dropping projectId). Rather than widen that shared
// contract for one provider family, this reads the full PlumbOAuthCredential
// directly from the canonical PlumbProviderRegistry.
async function* googleCloudCodeAssistStream(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const { model, messages, tools, signal, systemPrompt } = options;

  const { getPlumbProviderRegistry } = await import(
    '../registry/provider-registry.js'
  );
  const credential = getPlumbProviderRegistry().getProviderState(
    model.provider,
  )?.credentials;

  if (
    !credential ||
    credential.type !== 'oauth' ||
    !credential.access ||
    !credential.projectId
  ) {
    yield {
      type: 'error',
      error: {
        code: 'MISSING_CREDENTIAL',
        message: `No credential available for provider: ${model.provider}. Sign in again via /login ${model.provider}.`,
      },
    };
    return;
  }
  const accessToken = credential.access;
  const projectId = credential.projectId;

  const { DEFAULT_ENDPOINT, getAntigravityUserAgent } = await import(
    '../omp-ai/providers/google-gemini-cli.js'
  );
  const baseUrl = (model.baseUrl ?? DEFAULT_ENDPOINT).replace(/\/+$/, '');
  const url = `${baseUrl}/v1internal:streamGenerateContent?alt=sse`;

  const isAntigravity = model.provider === 'google-antigravity';
  const contents = buildGeminiContents(messages);
  const request: Record<string, unknown> = { contents };
  if (systemPrompt) {
    request['systemInstruction'] = { parts: [{ text: systemPrompt }] };
  }
  if (tools && tools.length > 0) {
    request['tools'] = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
    ];
  }
  const body = {
    project: projectId,
    model: model.requestModelId ?? model.id,
    request,
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (isAntigravity) {
    headers['User-Agent'] = getAntigravityUserAgent();
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
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
    // Never surface the raw response body: it can echo request context
    // (this endpoint has previously returned bodies referencing the request
    // path) and, more importantly, must never be trusted to be secret-free.
    yield {
      type: 'error',
      error: {
        code: `HTTP_${response.status}`,
        message: `${model.provider} request failed (HTTP ${response.status}).`,
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

function buildOpenAIMessages(
  messages: PlumbStreamOptions['messages'],
  systemPrompt?: string,
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }
  for (const msg of messages) {
    if (msg.role === 'system') {
      result.push({ role: 'system', content: msg.content });
    } else if (msg.role === 'assistant') {
      result.push({ role: 'assistant', content: msg.content });
    } else if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        content: msg.content,
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
    return { role: 'assistant', content: msg.content };
  }
  return {
    role: 'user',
    content: typeof msg.content === 'string' ? msg.content : '',
  };
}

function buildGeminiContents(
  messages: PlumbStreamOptions['messages'],
): Record<string, unknown>[] {
  const contents: Record<string, unknown>[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue; // Handled by systemInstruction
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts: unknown[] = [];
    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    }
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

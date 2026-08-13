/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Azure OpenAI transport — real production dialect (`azure-openai-responses`,
 * see omp-catalog/models.json's `azure` entries), targeting Azure's actual
 * Responses API (`{baseUrl}/responses?api-version=...`), never the generic
 * OpenAI-compatible Chat Completions passthrough.
 *
 * ENDPOINT/DEPLOYMENT: resolved through PLUMB's canonical config precedence
 * (`resolveProviderConfigValue`: PLUMB-saved > env > default), matching the
 * real upstream OMP Azure provider's own resolution order
 * (`omp-ai/providers/azure-openai-responses.ts`'s `resolveAzureConfig` /
 * `resolveDeploymentName`) --
 *   baseUrl:     AZURE_OPENAI_BASE_URL, else `https://{resourceName}.openai.azure.com/openai/v1`
 *   deployment:  AZURE_OPENAI_DEPLOYMENT_NAME_MAP ("model=deployment,...",
 *                parsed by the shared, reused `parseAzureDeploymentNameMap`),
 *                falling back to the model id itself.
 *
 * CREDENTIAL: `api-key` header (never `Authorization: Bearer` -- Azure
 * rejects that for the Responses API; this exactly mirrors the real
 * `AzureOpenAI` SDK client's request shape, see azure-openai-responses.ts's
 * own comment on this).
 *
 * SCOPE: text + streaming + system prompt + multi-turn history + usage +
 * cancellation + tool/function calling via the Responses API's native
 * `function_call`/`function_call_output` input items. Tool EXECUTION is
 * never performed here -- this transport only translates
 * `response.function_call_arguments.done` into PLUMB's generic `tool_call`
 * PlumbStreamEvent; the caller's normal CoreToolScheduler-backed agent loop
 * executes the tool and reinjects the result as a `role: 'tool'` message on
 * the next turn.
 *
 * Official docs referenced: Azure OpenAI Responses API
 * (https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/responses).
 */

import type { PlumbStreamEvent, PlumbStreamOptions } from '../types.js';
import { resolveProviderConfigValue } from '../config/providerConfigResolver.js';
import { parseAzureDeploymentNameMap } from '../omp-ai/providers/openai-shared.js';
import {
  resolveEffectiveToolChoice,
  resolveRouteToolPolicy,
} from '../tool-policy.js';

const AZURE_PROVIDER_ID = 'azure';
const DEFAULT_API_VERSION = 'v1';

function resolveAzureBaseUrl(): string | undefined {
  const explicit = resolveProviderConfigValue(
    AZURE_PROVIDER_ID,
    'baseUrl',
    'AZURE_OPENAI_BASE_URL',
  )?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const resourceName = resolveProviderConfigValue(
    AZURE_PROVIDER_ID,
    'resourceName',
    'AZURE_OPENAI_RESOURCE_NAME',
  );
  if (resourceName) {
    return `https://${resourceName}.openai.azure.com/openai/v1`;
  }
  return undefined;
}

function resolveAzureApiVersion(): string {
  return (
    resolveProviderConfigValue(
      AZURE_PROVIDER_ID,
      'apiVersion',
      'AZURE_OPENAI_API_VERSION',
    ) ?? DEFAULT_API_VERSION
  );
}

/**
 * PLUMB's in-app deployment manager persists the same "model=deployment,..."
 * string shape a user could set via AZURE_OPENAI_DEPLOYMENT_NAME_MAP, so
 * this reuses the same parser regardless of which source it came from
 * (identical to the real upstream provider's own resolveDeploymentName).
 */
function resolveAzureDeploymentName(modelId: string): string {
  const rawMap = resolveProviderConfigValue(
    AZURE_PROVIDER_ID,
    'deploymentMap',
    'AZURE_OPENAI_DEPLOYMENT_NAME_MAP',
  );
  const mapped = parseAzureDeploymentNameMap(rawMap).get(modelId);
  return mapped ?? modelId;
}

type ResponsesInputItem =
  | { role: 'user' | 'assistant' | 'system'; content: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

function safeParseToolArguments(raw: string): string {
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return '{}';
  }
}

/**
 * Converts PLUMB's generic message shape into Responses API `input` items.
 * The Responses API has no dedicated `tool` role -- a tool result becomes a
 * `function_call_output` item, and assistant tool calls become
 * `function_call` items, addressed by `call_id` (PLUMB's `part.id`).
 */
function buildResponsesInputItems(
  messages: PlumbStreamOptions['messages'],
): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];
  for (const msg of messages) {
    if (msg.role === 'tool') {
      items.push({
        type: 'function_call_output',
        call_id: msg.toolCallId ?? '',
        output:
          typeof msg.content === 'string'
            ? msg.content
            : msg.content
                .filter((p) => p.type === 'text')
                .map((p) => (p as { text: string }).text)
                .join(''),
      });
      continue;
    }

    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        if (msg.content)
          items.push({ role: 'assistant', content: msg.content });
        continue;
      }
      let text = '';
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) {
          text += part.text;
        } else if (part.type === 'tool_call') {
          if (text) {
            items.push({ role: 'assistant', content: text });
            text = '';
          }
          items.push({
            type: 'function_call',
            call_id: part.id,
            name: part.name,
            arguments: safeParseToolArguments(part.arguments),
          });
        }
      }
      if (text) items.push({ role: 'assistant', content: text });
      continue;
    }

    const role = msg.role === 'system' ? 'system' : 'user';
    if (typeof msg.content === 'string') {
      if (msg.content) items.push({ role, content: msg.content });
      continue;
    }
    const text = msg.content
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text: string }).text)
      .join('');
    if (text) items.push({ role, content: text });
  }
  return items;
}

function buildResponsesTools(options: PlumbStreamOptions):
  | Array<{
      type: 'function';
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>
  | undefined {
  if (
    !options.tools ||
    options.tools.length === 0 ||
    options.toolChoice?.mode === 'none'
  )
    return undefined;
  return options.tools.map((t) => ({
    type: 'function',
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
}

function serializeResponsesToolChoice(
  choice: NonNullable<PlumbStreamOptions['toolChoice']>,
): unknown {
  if (choice.mode === 'named') {
    return { type: 'function', name: choice.name };
  }
  return choice.mode;
}

function classifyAzureHttpError(
  status: number,
  bodyText: string,
): { code: string; message: string } {
  const message = bodyText.slice(0, 1000) || `Azure OpenAI HTTP ${status}`;
  if (status === 401 || status === 403)
    return { code: 'AUTH_REQUIRED', message };
  if (status === 404) return { code: 'MODEL_NOT_AVAILABLE', message };
  if (status === 429) return { code: 'RATE_LIMITED', message };
  if (status === 400 || status === 422)
    return { code: 'INVALID_REQUEST', message };
  if (status >= 500) return { code: 'UPSTREAM_ERROR', message };
  return { code: 'NETWORK_ERROR', message };
}

/**
 * Streams an Azure OpenAI Responses API turn. Builds the real deployment-
 * resolved request against the real `/responses` endpoint and normalizes
 * the real Responses API SSE event stream into PlumbStreamEvent.
 */
export async function* streamAzureResponses(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const { model, messages, systemPrompt, apiKey, signal, maxTokens } = options;

  const baseUrl = resolveAzureBaseUrl() ?? model.baseUrl;
  if (!baseUrl) {
    yield {
      type: 'error',
      error: {
        code: 'INVALID_REQUEST',
        message:
          'Azure OpenAI base URL is required. Set AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME, or configure it via PLUMB provider setup.',
      },
    };
    return;
  }
  if (!apiKey) {
    yield {
      type: 'error',
      error: {
        code: 'MISSING_CREDENTIAL',
        message:
          'No credential available for provider: azure. Sign in again via /login azure.',
      },
    };
    return;
  }

  const apiVersion = resolveAzureApiVersion();
  const url = `${baseUrl}/responses?api-version=${encodeURIComponent(apiVersion)}`;
  const deploymentName = resolveAzureDeploymentName(
    model.requestModelId ?? model.id,
  );

  const inputItems = buildResponsesInputItems(messages);
  const tools = buildResponsesTools(options);
  const effectiveChoice = resolveEffectiveToolChoice(
    resolveRouteToolPolicy(model),
    options.toolChoice,
    tools?.length ?? 0,
  ).value;
  const body: Record<string, unknown> = {
    model: deploymentName,
    input: inputItems,
    stream: true,
    ...(systemPrompt ? { instructions: systemPrompt } : {}),
    ...(maxTokens ? { max_output_tokens: maxTokens } : {}),
    ...(tools ? { tools } : {}),
    ...(effectiveChoice
      ? { tool_choice: serializeResponsesToolChoice(effectiveChoice) }
      : {}),
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
        ...(model.headers ?? {}),
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
    const errorText = await response.text().catch(() => '');
    yield {
      type: 'error',
      error: classifyAzureHttpError(response.status, errorText),
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
  let finishReason = 'stop';
  const pendingCalls = new Map<
    string,
    { callId: string; name: string; arguments: string; emitted: boolean }
  >();
  function* emitPendingCalls(): Generator<PlumbStreamEvent> {
    for (const pending of pendingCalls.values()) {
      if (pending.emitted) continue;
      pending.emitted = true;
      yield {
        type: 'tool_call',
        toolCall: {
          id: pending.callId,
          name: pending.name,
          arguments: pending.arguments,
        },
      };
    }
  }

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

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        switch (event['type']) {
          case 'response.output_text.delta': {
            const delta = event['delta'];
            if (typeof delta === 'string' && delta) {
              yield { type: 'text', text: delta };
            }
            break;
          }
          case 'response.output_item.added': {
            const item = event['item'] as
              | {
                  id?: string;
                  type?: string;
                  call_id?: string;
                  name?: string;
                  arguments?: string;
                }
              | undefined;
            if (item?.type === 'function_call' && item.id && item.call_id) {
              pendingCalls.set(item.id, {
                callId: item.call_id,
                name: item.name ?? '',
                arguments: item.arguments ?? '',
                emitted: false,
              });
            }
            break;
          }
          case 'response.function_call_arguments.delta': {
            const itemId = event['item_id'] as string | undefined;
            const delta = event['delta'] as string | undefined;
            const pending = itemId ? pendingCalls.get(itemId) : undefined;
            if (pending && typeof delta === 'string')
              pending.arguments += delta;
            break;
          }
          case 'response.function_call_arguments.done': {
            const itemId = event['item_id'] as string | undefined;
            const name = event['name'] as string | undefined;
            const args = event['arguments'] as string | undefined;
            const pending = itemId ? pendingCalls.get(itemId) : undefined;
            if (pending && !pending.emitted) {
              pending.emitted = true;
              yield {
                type: 'tool_call',
                toolCall: {
                  id: pending.callId,
                  name: name ?? pending.name,
                  arguments: args ?? pending.arguments,
                },
              };
            }
            break;
          }
          case 'response.output_item.done': {
            const item = event['item'] as
              | {
                  id?: string;
                  type?: string;
                  call_id?: string;
                  name?: string;
                  arguments?: string;
                }
              | undefined;
            if (item?.type === 'function_call' && item.id) {
              const pending = pendingCalls.get(item.id);
              if (pending && !pending.emitted) {
                pending.emitted = true;
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: pending.callId,
                    name: item.name ?? pending.name,
                    arguments: item.arguments ?? pending.arguments,
                  },
                };
              }
            }
            break;
          }
          case 'response.completed': {
            const resp = event['response'] as
              | {
                  status?: string;
                  usage?: {
                    input_tokens?: number;
                    output_tokens?: number;
                    total_tokens?: number;
                  };
                  output?: Array<{ type?: string }>;
                }
              | undefined;
            if (resp?.output?.some((o) => o.type === 'function_call')) {
              finishReason = 'tool_calls';
            }
            for (const pending of emitPendingCalls()) yield pending;
            if (resp?.usage) {
              yield {
                type: 'usage',
                usage: {
                  inputTokens: resp.usage.input_tokens ?? 0,
                  outputTokens: resp.usage.output_tokens ?? 0,
                  totalTokens:
                    resp.usage.total_tokens ??
                    (resp.usage.input_tokens ?? 0) +
                      (resp.usage.output_tokens ?? 0),
                },
              };
            }
            break;
          }
          case 'response.failed':
          case 'error': {
            const err =
              (
                event['response'] as
                  | { error?: { message?: string } }
                  | undefined
              )?.error ?? (event['error'] as { message?: string } | undefined);
            yield {
              type: 'error',
              error: {
                code: 'UPSTREAM_ERROR',
                message:
                  err?.message ?? 'Azure OpenAI Responses API request failed',
              },
            };
            return;
          }
          default:
            break;
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    yield {
      type: 'error',
      error: { code: 'STREAM_ERROR', message: (err as Error).message },
    };
    return;
  } finally {
    reader.releaseLock();
  }

  for (const pending of emitPendingCalls()) yield pending;
  yield { type: 'done', finishReason };
}

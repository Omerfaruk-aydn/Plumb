/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provider-neutral OpenAI Responses transport. Route policy remains on the
 * resolved PlumbModel; this module owns only the native Responses wire shape.
 */

import type {
  PlumbStreamEvent,
  PlumbStreamOptions,
  PlumbToolChoice,
} from '../types.js';
import {
  resolveEffectiveToolChoice,
  resolveRouteToolPolicy,
} from '../tool-policy.js';
import {
  contentToText,
  splitAssistantContent,
  recordToolRouteRequest,
  recordToolRouteHttpFailure,
  recordToolRouteTextDelta,
  recordToolRouteToolCallDelta,
  recordToolRouteFinishReason,
  recordToolRouteNormalizedCall,
} from './streaming.js';
import {
  getCustomProviderDefinition,
  resolveCustomCredentialHeader,
} from '../config/customProviderDefinitions.js';
import {
  classifyGenericHttpError,
  extractSafeResponsesErrorDetails,
} from './errorClassification.js';

type ResponsesInputItem = Record<string, unknown>;

function serializeToolChoice(choice: PlumbToolChoice): unknown {
  switch (choice.mode) {
    case 'auto':
    case 'required':
    case 'none':
      return choice.mode;
    case 'named':
      return { type: 'function', name: choice.name };
  }
}

function buildInput(options: PlumbStreamOptions): ResponsesInputItem[] {
  const input: ResponsesInputItem[] = [];
  if (options.systemPrompt) {
    input.push({ role: 'developer', content: options.systemPrompt });
  }
  for (const message of options.messages) {
    if (message.role === 'system') {
      input.push({
        role: 'developer',
        content: contentToText(message.content),
      });
      continue;
    }
    if (message.role === 'assistant') {
      const split = splitAssistantContent(message.content);
      if (split.text) input.push({ role: 'assistant', content: split.text });
      for (const call of split.toolCalls) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        });
      }
      continue;
    }
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.toolCallId ?? '',
        output: contentToText(message.content),
      });
      continue;
    }
    input.push({ role: 'user', content: contentToText(message.content) });
  }
  return input;
}

function setHeaderCaseInsensitive(
  headers: Record<string, string>,
  name: string,
  value: string,
): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
  }
  headers[name] = value;
}

function buildHeaders(options: PlumbStreamOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.model.headers ?? {}),
  };
  const custom = getCustomProviderDefinition(options.model.provider);
  if (custom) {
    const credential = resolveCustomCredentialHeader(
      custom.credentialPlacement,
      options.apiKey,
    );
    if (credential)
      setHeaderCaseInsensitive(headers, credential.name, credential.value);
  } else if (options.model.provider === 'cloudflare-ai-gateway') {
    setHeaderCaseInsensitive(
      headers,
      'cf-aig-authorization',
      `Bearer ${options.apiKey}`,
    );
  } else if (options.apiKey) {
    setHeaderCaseInsensitive(
      headers,
      'Authorization',
      `Bearer ${options.apiKey}`,
    );
  }
  return headers;
}

interface PendingCall {
  itemId: string;
  callId: string;
  name: string;
  arguments: string;
  emitted: boolean;
}

/** Native `/responses` request, event parsing, and PLUMB-managed replay. */
export async function* streamOpenAIResponses(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const { model, tools, signal } = options;

  // AUTHORITY INVARIANT: credential must be validated before any request
  // construction or network activity.
  const isKeylessCustom =
    getCustomProviderDefinition(model.provider)?.credentialPlacement === 'none';
  if (!options.apiKey && !isKeylessCustom) {
    yield {
      type: 'error',
      error: {
        code: 'MISSING_CREDENTIAL',
        message: `No credential available for provider: ${model.provider}. Sign in again via /login ${model.provider}.`,
      },
    };
    return;
  }

  const wireModel = model.requestModelId ?? model.id;
  const body: Record<string, unknown> = {
    model: wireModel,
    input: buildInput(options),
    stream: true,
  };

  if (tools?.length && model.toolsSupported === true) {
    body['tools'] = tools.map((tool) => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }));
    const effective = resolveEffectiveToolChoice(
      resolveRouteToolPolicy(model),
      options.toolChoice,
      tools.length,
    );
    if (effective.value)
      body['tool_choice'] = serializeToolChoice(effective.value);
    recordToolRouteRequest(tools.length, wireModel, options, effective.value, {
      requestFamily: 'openai-responses',
      endpointPath: '/responses',
      toolSerializationShape: 'RESPONSES_FLAT',
      toolsPresent: true,
      hasInput: body['input'] !== undefined,
      inputItemCount: Array.isArray(body['input'])
        ? (body['input'] as unknown[]).length
        : 0,
      parallelToolCallsPresent: body['parallel_tool_calls'] !== undefined,
      maxOutputTokensFieldName:
        body['max_output_tokens'] !== undefined
          ? 'max_output_tokens'
          : 'absent',
      reasoningFieldPresent: body['reasoning'] !== undefined,
    });
  } else {
    recordToolRouteRequest(0, wireModel, options, undefined, {
      requestFamily: 'openai-responses',
      endpointPath: '/responses',
      toolSerializationShape: 'none',
      toolsPresent: false,
      hasInput: body['input'] !== undefined,
      inputItemCount: Array.isArray(body['input'])
        ? (body['input'] as unknown[]).length
        : 0,
      parallelToolCallsPresent: body['parallel_tool_calls'] !== undefined,
      maxOutputTokensFieldName:
        body['max_output_tokens'] !== undefined
          ? 'max_output_tokens'
          : 'absent',
      reasoningFieldPresent: body['reasoning'] !== undefined,
    });
  }
  if (options.maxTokens) body['max_output_tokens'] = options.maxTokens;
  if (options.temperature !== undefined && !model.reasoning) {
    body['temperature'] = options.temperature;
  }
  if (options.reasoningEffort) {
    body['reasoning'] = { effort: options.reasoningEffort };
  }

  const url = `${(model.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')}/responses`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(options),
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    yield {
      type: 'error',
      error: { code: 'NETWORK_ERROR', message: (error as Error).message },
    };
    return;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    const classified = classifyGenericHttpError(response.status, text);
    recordToolRouteHttpFailure(
      response.status,
      classified.code,
      [],
      {
        ...extractSafeResponsesErrorDetails(text),
      },
      options,
    );
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

  const byItemId = new Map<string, PendingCall>();
  const byCallId = new Map<string, PendingCall>();
  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | undefined;

  const emitCall = function* (call: PendingCall): Generator<PlumbStreamEvent> {
    if (call.emitted) return;
    call.emitted = true;
    recordToolRouteNormalizedCall(call.name, options);
    yield {
      type: 'tool_call',
      toolCall: {
        id: call.callId,
        name: call.name,
        arguments: call.arguments || '{}',
      },
    };
  };
  const lookup = (event: Record<string, unknown>): PendingCall | undefined => {
    const itemId = event['item_id'];
    const callId = event['call_id'];
    return (
      (typeof itemId === 'string' ? byItemId.get(itemId) : undefined) ??
      (typeof callId === 'string' ? byCallId.get(callId) : undefined)
    );
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const type = event['type'];
        if (type === 'response.output_text.delta') {
          const delta = event['delta'];
          if (typeof delta === 'string' && delta) {
            recordToolRouteTextDelta(options);
            yield { type: 'text', text: delta };
          }
        } else if (type === 'response.output_item.added') {
          const item = event['item'] as Record<string, unknown> | undefined;
          if (item?.['type'] === 'function_call') {
            const itemId = String(item['id'] ?? event['item_id'] ?? '');
            const callId = String(item['call_id'] ?? itemId);
            if (itemId && callId) {
              const pending: PendingCall = {
                itemId,
                callId,
                name: String(item['name'] ?? ''),
                arguments: String(item['arguments'] ?? ''),
                emitted: false,
              };
              byItemId.set(itemId, pending);
              byCallId.set(callId, pending);
            }
          }
        } else if (type === 'response.function_call_arguments.delta') {
          const pending = lookup(event);
          const delta = event['delta'];
          if (pending && typeof delta === 'string') {
            pending.arguments += delta;
            recordToolRouteToolCallDelta(options);
          }
        } else if (type === 'response.function_call_arguments.done') {
          const pending = lookup(event);
          if (pending) {
            if (typeof event['name'] === 'string') pending.name = event['name'];
            if (typeof event['arguments'] === 'string') {
              pending.arguments = event['arguments'];
            }
            yield* emitCall(pending);
          }
        } else if (type === 'response.output_item.done') {
          const item = event['item'] as Record<string, unknown> | undefined;
          if (item?.['type'] === 'function_call') {
            const itemId = String(item['id'] ?? event['item_id'] ?? '');
            const callId = String(item['call_id'] ?? itemId);
            let pending = byItemId.get(itemId) ?? byCallId.get(callId);
            if (!pending) {
              pending = {
                itemId,
                callId,
                name: String(item['name'] ?? ''),
                arguments: String(item['arguments'] ?? ''),
                emitted: false,
              };
            } else {
              if (typeof item['name'] === 'string') pending.name = item['name'];
              if (typeof item['arguments'] === 'string') {
                pending.arguments = item['arguments'];
              }
            }
            yield* emitCall(pending);
          }
        } else if (type === 'response.completed') {
          const completed = event['response'] as
            | Record<string, unknown>
            | undefined;
          const output = completed?.['output'];
          finishReason =
            Array.isArray(output) &&
            output.some(
              (item) =>
                typeof item === 'object' &&
                item !== null &&
                (item as Record<string, unknown>)['type'] === 'function_call',
            )
              ? 'tool_calls'
              : 'stop';
          recordToolRouteFinishReason(finishReason, options);
          const usage = completed?.['usage'] as
            | Record<string, number>
            | undefined;
          if (usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: usage['input_tokens'] ?? 0,
                outputTokens: usage['output_tokens'] ?? 0,
                totalTokens:
                  usage['total_tokens'] ??
                  (usage['input_tokens'] ?? 0) + (usage['output_tokens'] ?? 0),
              },
            };
          }
        } else if (type === 'response.failed' || type === 'error') {
          yield {
            type: 'error',
            error: {
              code: 'UPSTREAM_ERROR',
              message: 'Responses API request failed.',
            },
          };
          return;
        }
      }
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    yield {
      type: 'error',
      error: { code: 'STREAM_ERROR', message: (error as Error).message },
    };
    return;
  } finally {
    reader.releaseLock();
  }

  for (const pending of byItemId.values()) yield* emitCall(pending);
  yield { type: 'done', finishReason };
}

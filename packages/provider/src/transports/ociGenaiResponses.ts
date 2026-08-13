/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * OCI Generative AI Responses transport (`oci-openai-responses` dialect).
 * Oracle documents the Responses API as its primary OpenAI-compatible
 * interface for new/agentic workloads (Chat Completions remains available
 * separately via the generic `openai-completions` transport + the
 * `openai.gpt-oss-*` static catalog entries' existing wiring). This is a
 * distinct, explicit dialect -- not folded into `openai-completions` --
 * because OCI's Responses calls carry OCI-specific authentication
 * (OCI_GENAI_API_KEY bearer OR OCI_IAM request signing, see
 * ociGenaiIamAuth.ts), project/region/compartment identity, and a
 * different supported-capability surface than a generic OpenAI Responses
 * endpoint.
 *
 * AUTH: resolves `OCI_IAM_AUTH_MODE` first -- if set, the request is signed
 * via ociGenaiIamAuth.ts's real `oci-common`-backed signer (OCI_IAM
 * credential authority); otherwise falls back to the existing
 * `OCI_GENAI_API_KEY` bearer credential (`options.apiKey`). The two modes
 * are mutually exclusive per request: IAM mode never reads `options.apiKey`,
 * API-key mode never touches the OCI IAM signer.
 *
 * SIGNING BOUNDARY: the request (method/url/headers/body) is fully built --
 * including opc-compartment-id/OpenAI-Project headers -- BEFORE signing.
 * Signing is the last mutation before fetch; nothing touches the request
 * afterward.
 *
 * TOOLS: only PLUMB_CLIENT_TOOL (plain `function` tools, PLUMB's own
 * CoreToolScheduler-backed tools) are ever sent. OCI_MANAGED_TOOL types
 * (`file_search`, `code_interpreter`, MCP-backed tools that OCI's Responses
 * API also supports) are deliberately never advertised or requested here --
 * PLUMB has no safe product UX for a server-managed tool result yet, so
 * offering one would silently misrepresent what PLUMB can actually do with
 * the result. Tool EXECUTION never happens in this file: streamed
 * `function_call` items are translated into PLUMB's generic `tool_call`
 * PlumbStreamEvent, exactly like every other OpenAI-family transport --
 * the caller's normal CoreToolScheduler-backed agent loop executes the
 * tool and reinjects the result as a `function_call_output` input item on
 * the next turn (see buildResponsesInput below).
 *
 * CONVERSATION STATE: PLUMB_MANAGED_HISTORY, not OCI's server-side
 * `/conversations` resource -- every call resends the full message history
 * PLUMB already owns (via `buildResponsesInput`), exactly like every other
 * transport in this package. This is a deliberate choice, not an oversight:
 * adopting OCI's stateful conversation resource would create a second,
 * provider-specific conversation authority alongside PLUMB's own, and
 * PLUMB's cross-provider behavior (switching models/providers mid-session)
 * must stay deterministic regardless of which provider is selected.
 */

import type { PlumbStreamEvent, PlumbStreamOptions } from '../types.js';
import { splitAssistantContent, contentToText } from './streaming.js';
import {
  resolveOciIamAuthMode,
  getOciIamAuthProvider,
  signOciGenaiRequest,
} from './ociGenaiIamAuth.js';
import {
  resolveEffectiveToolChoice,
  resolveRouteToolPolicy,
} from '../tool-policy.js';

/**
 * Responses API `input` items are flat (unlike Chat Completions' nested
 * per-role messages): a prior tool call becomes its own `function_call`
 * item, a tool result becomes its own `function_call_output` item. Reuses
 * `splitAssistantContent`/`contentToText` (streaming.ts) for the actual
 * content-part walking rather than a third reimplementation of that logic.
 */
function buildResponsesInput(
  messages: PlumbStreamOptions['messages'],
): Record<string, unknown>[] {
  const input: Record<string, unknown>[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      // Folded into the top-level `instructions` field instead (see
      // streamOciGenaiResponses) -- Responses API's dedicated mechanism
      // for a system prompt, not a role in the `input` array.
      continue;
    }
    if (msg.role === 'user') {
      input.push({ role: 'user', content: contentToText(msg.content) });
    } else if (msg.role === 'assistant') {
      const { text, toolCalls } = splitAssistantContent(msg.content);
      if (text) {
        input.push({ role: 'assistant', content: text });
      }
      for (const tc of toolCalls) {
        input.push({
          type: 'function_call',
          call_id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        });
      }
    } else if (msg.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: msg.toolCallId,
        output: contentToText(msg.content),
      });
    }
  }
  return input;
}

interface ResponsesTool {
  type: 'function';
  name: string;
  description: string;
  parameters: unknown;
}

/**
 * Flat tool shape (Responses API removes Chat Completions' nested
 * `function: {...}` wrapper -- `name`/`description`/`parameters` live
 * directly on the tool object). Only ever emits PLUMB_CLIENT_TOOL entries;
 * see module doc for why OCI_MANAGED_TOOL types are never included here.
 */
function buildResponsesTools(
  options: PlumbStreamOptions,
): ResponsesTool[] | undefined {
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

function classifyOciResponsesError(
  status: number,
  message: string,
): { code: string; message: string } {
  if (status === 401 || status === 403) {
    return { code: 'AUTH_REQUIRED', message };
  }
  if (status === 404) {
    return { code: 'MODEL_NOT_AVAILABLE', message };
  }
  if (status === 429) {
    return { code: 'RATE_LIMITED', message };
  }
  if (status === 400 || status === 422) {
    return { code: 'INVALID_REQUEST', message };
  }
  if (status >= 500) {
    return { code: 'UPSTREAM_ERROR', message };
  }
  return { code: 'NETWORK_ERROR', message };
}

/**
 * Builds and, per the configured auth mode, signs the outbound request.
 * The full header set (Content-Type + model.headers, which already carries
 * opc-compartment-id/OpenAI-Project -- see catalog/model-catalog.ts) is
 * assembled BEFORE either branch runs, so OCI_IAM signing always covers
 * every header the request will actually carry.
 */
async function buildAuthenticatedRequest(
  url: string,
  body: Record<string, unknown>,
  options: PlumbStreamOptions,
): Promise<{ headers: Headers; error?: PlumbStreamEvent }> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (options.model.headers) {
    for (const [key, value] of Object.entries(options.model.headers)) {
      headers.set(key, value);
    }
  }

  const iamMode = resolveOciIamAuthMode();
  const bodyString = JSON.stringify(body);
  if (iamMode) {
    const provider = await getOciIamAuthProvider(iamMode);
    await signOciGenaiRequest(provider, {
      method: 'POST',
      url,
      headers,
      body: bodyString,
    });
    return { headers };
  }

  if (!options.apiKey) {
    return {
      headers,
      error: {
        type: 'error',
        error: {
          code: 'MISSING_CREDENTIAL',
          message: `No credential available for provider: ${options.model.provider}. Sign in again via /login ${options.model.provider}.`,
        },
      },
    };
  }
  headers.set('Authorization', `Bearer ${options.apiKey}`);
  return { headers };
}

export async function* streamOciGenaiResponses(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const { model, messages, systemPrompt, maxTokens, temperature, signal } =
    options;

  const baseUrl = model.baseUrl ?? '';
  const url = `${baseUrl.replace(/\/+$/, '')}/responses`;

  const tools = buildResponsesTools(options);
  const effectiveChoice = resolveEffectiveToolChoice(
    resolveRouteToolPolicy(model),
    options.toolChoice,
    tools?.length ?? 0,
  ).value;
  const body: Record<string, unknown> = {
    model: model.requestModelId ?? model.id,
    input: buildResponsesInput(messages),
    stream: true,
    ...(systemPrompt ? { instructions: systemPrompt } : {}),
    ...(tools ? { tools } : {}),
    ...(effectiveChoice
      ? { tool_choice: serializeResponsesToolChoice(effectiveChoice) }
      : {}),
    ...(maxTokens ? { max_output_tokens: maxTokens } : {}),
    ...(temperature !== undefined && temperature >= 0 ? { temperature } : {}),
  };

  // BUILD FINAL REQUEST -> headers already include project/compartment ->
  // SIGN FINAL REQUEST (IAM mode only) -> FETCH. No mutation after this.
  const { headers, error } = await buildAuthenticatedRequest(
    url,
    body,
    options,
  );
  if (error) {
    yield error;
    return;
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
    yield {
      type: 'error',
      error: {
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Network request failed',
      },
    };
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    yield {
      type: 'error',
      error: classifyOciResponsesError(response.status, text),
    };
    return;
  }
  if (!response.body) {
    yield {
      type: 'error',
      error: { code: 'NETWORK_ERROR', message: 'Empty response body' },
    };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | undefined;
  // item_id -> native call metadata + accumulated arguments. Argument deltas
  // are fragments, not independent calls, so each item is emitted once.
  // The map also preserves the call_id the eventual function_call_output
  // must reference.
  const pendingFunctionCalls = new Map<
    string,
    { callId: string; name: string; arguments: string; emitted: boolean }
  >();
  function* emitPendingCalls(): Generator<PlumbStreamEvent> {
    for (const pending of pendingFunctionCalls.values()) {
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
        const eventType = event['type'];

        if (eventType === 'response.output_text.delta') {
          const delta = event['delta'];
          if (typeof delta === 'string' && delta) {
            yield { type: 'text', text: delta };
          }
        } else if (eventType === 'response.output_item.added') {
          const item = event['item'] as
            | { id?: string; type?: string; call_id?: string; name?: string }
            | undefined;
          if (item?.type === 'function_call' && item.id && item.call_id) {
            pendingFunctionCalls.set(item.id, {
              callId: item.call_id,
              name: item.name ?? '',
              arguments: '',
              emitted: false,
            });
          }
        } else if (eventType === 'response.function_call_arguments.delta') {
          const itemId = event['item_id'];
          const delta = event['delta'];
          if (typeof itemId === 'string' && typeof delta === 'string') {
            const pending = pendingFunctionCalls.get(itemId);
            if (pending) {
              pending.arguments += delta;
            }
          }
        } else if (eventType === 'response.output_item.done') {
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
            const pending = pendingFunctionCalls.get(item.id);
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
        } else if (eventType === 'response.completed') {
          const responseObj = event['response'] as
            | { usage?: Record<string, number>; status?: string }
            | undefined;
          const usage = responseObj?.usage;
          for (const pending of emitPendingCalls()) yield pending;
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
          finishReason = 'stop';
        } else if (eventType === 'error') {
          const message = event['message'];
          yield {
            type: 'error',
            error: {
              code: 'UPSTREAM_ERROR',
              message:
                typeof message === 'string'
                  ? message
                  : 'OCI Responses API error',
            },
          };
          return;
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      yield { type: 'done', finishReason: 'cancelled' };
      return;
    }
    yield {
      type: 'error',
      error: {
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Stream read failed',
      },
    };
    return;
  }

  for (const pending of emitPendingCalls()) yield pending;
  yield { type: 'done', finishReason: finishReason ?? 'stop' };
}

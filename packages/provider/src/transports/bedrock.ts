/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * AWS Bedrock Converse Stream transport — real production dialect
 * (`bedrock-converse-stream`, see omp-catalog/models.json's `amazon-bedrock`
 * entries), never a generic OpenAI-compatible passthrough.
 *
 * CREDENTIAL AUTHORITY: the standard AWS credential chain (env static keys,
 * `~/.aws/credentials` profile, SSO, credential_process, EC2 IMDSv2 — see
 * `aws-credentials.ts`'s `resolveAwsCredentials`) or, when set, an
 * `AWS_BEARER_TOKEN_BEDROCK` bearer token. PLUMB never invents its own
 * signing or credential resolution here — every AWS-specific primitive
 * (`resolveAwsCredentials`, `signRequest`, `decodeEventStream`) is imported
 * unchanged from the existing, exported OMP Bedrock provider module, the
 * same real implementation the upstream `omp-ai/stream.ts` dispatcher uses.
 *
 * REGION: PLUMB config (`resolveProviderConfigValue`) beats
 * `AWS_REGION`/`AWS_DEFAULT_REGION`, same precedence as every other cloud
 * provider (see providerConfigResolver.ts) — falls back to `us-east-1`.
 *
 * SCOPE: text + streaming + system prompt + multi-turn history + usage +
 * cancellation + tool/function calling via Bedrock's native Converse
 * `toolUse`/`toolResult` content blocks. Tool EXECUTION is never performed
 * here — this transport only translates `contentBlockStart`/`Delta` toolUse
 * events into PLUMB's generic `tool_call` PlumbStreamEvent; the caller's
 * normal CoreToolScheduler-backed agent loop executes the tool and reinjects
 * the result as a `role: 'tool'` message on the next turn.
 *
 * Official docs referenced: Bedrock Runtime ConverseStream
 * (https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html).
 */

import type { PlumbStreamEvent, PlumbStreamOptions } from '../types.js';
import { resolveProviderConfigValue } from '../config/providerConfigResolver.js';
import {
  resolveAwsCredentials,
  invalidateAwsCredentialCache,
} from '../omp-ai/providers/aws-credentials.js';
import { signRequest } from '../omp-ai/providers/aws-sigv4.js';
import { decodeEventStream } from '../omp-ai/providers/aws-eventstream.js';

const BEDROCK_PROVIDER_ID = 'amazon-bedrock';
const DEFAULT_REGION = 'us-east-1';

/**
 * Resolves the Bedrock runtime region through PLUMB's canonical config
 * precedence (PLUMB-saved > AWS_REGION/AWS_DEFAULT_REGION > default).
 * Deliberately simpler than the upstream OMP provider's cross-region
 * inference-profile geo-inference (`us.`/`eu.`/`apac.` prefix matching) --
 * an explicitly configured region always wins here, matching the pattern
 * already used for watsonx (`resolveWatsonxServiceUrl`) and oci-genai.
 */
export function resolveBedrockRegion(): string {
  return (
    resolveProviderConfigValue(BEDROCK_PROVIDER_ID, 'region', 'AWS_REGION') ??
    process.env['AWS_DEFAULT_REGION']?.trim() ??
    DEFAULT_REGION
  );
}

function resolveBedrockProfile(): string | undefined {
  return resolveProviderConfigValue(
    BEDROCK_PROVIDER_ID,
    'profile',
    'AWS_PROFILE',
  );
}

interface BedrockContentBlock {
  text?: string;
  toolUse?: { toolUseId: string; name: string; input: unknown };
  toolResult?: {
    toolUseId: string;
    content: Array<{ text: string }>;
    status?: 'success' | 'error';
  };
}

interface BedrockMessage {
  role: 'user' | 'assistant';
  content: BedrockContentBlock[];
}

function safeParseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Converts PLUMB's generic message shape into Bedrock Converse API
 * messages. Bedrock (like Anthropic) has no dedicated `tool` role -- a tool
 * result travels as a `toolResult` content block inside a `user`-role
 * message, and assistant tool calls become `toolUse` content blocks.
 */
function buildBedrockMessages(
  messages: PlumbStreamOptions['messages'],
): BedrockMessage[] {
  const result: BedrockMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue; // Handled by the top-level `system` field.

    if (msg.role === 'tool') {
      result.push({
        role: 'user',
        content: [
          {
            toolResult: {
              toolUseId: msg.toolCallId ?? '',
              content: [
                {
                  text:
                    typeof msg.content === 'string'
                      ? msg.content
                      : msg.content
                          .filter((p) => p.type === 'text')
                          .map((p) => (p as { text: string }).text)
                          .join(''),
                },
              ],
            },
          },
        ],
      });
      continue;
    }

    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        if (!msg.content) continue;
        result.push({ role: 'assistant', content: [{ text: msg.content }] });
        continue;
      }
      const blocks: BedrockContentBlock[] = [];
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) {
          blocks.push({ text: part.text });
        } else if (part.type === 'tool_call') {
          blocks.push({
            toolUse: {
              toolUseId: part.id,
              name: part.name,
              input: safeParseToolArguments(part.arguments),
            },
          });
        }
      }
      if (blocks.length === 0) continue;
      result.push({ role: 'assistant', content: blocks });
      continue;
    }

    // user
    if (typeof msg.content === 'string') {
      if (!msg.content) continue;
      result.push({ role: 'user', content: [{ text: msg.content }] });
      continue;
    }
    const blocks: BedrockContentBlock[] = [];
    for (const part of msg.content) {
      if (part.type === 'text' && part.text) blocks.push({ text: part.text });
    }
    if (blocks.length === 0) continue;
    result.push({ role: 'user', content: blocks });
  }
  return result;
}

function buildBedrockToolConfig(options: PlumbStreamOptions):
  | {
      tools: Array<{
        toolSpec: {
          name: string;
          description: string;
          inputSchema: { json: Record<string, unknown> };
        };
      }>;
    }
  | undefined {
  if (!options.tools || options.tools.length === 0) return undefined;
  return {
    tools: options.tools.map((t) => ({
      toolSpec: {
        name: t.function.name,
        description: t.function.description,
        inputSchema: { json: t.function.parameters },
      },
    })),
  };
}

function classifyBedrockHttpError(
  status: number,
  bodyText: string,
): { code: string; message: string } {
  const message = bodyText.slice(0, 1000) || `Bedrock HTTP ${status}`;
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
 * Streams a Bedrock Converse turn. Resolves credentials/signs the request
 * with the real AWS SigV4 primitives (never a Bearer/OpenAI-shaped header),
 * decodes the real `application/vnd.amazon.eventstream` framing, and
 * normalizes Bedrock's Converse events into PlumbStreamEvent.
 */
export async function* streamBedrockConverse(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const { model, messages, systemPrompt, signal, maxTokens, temperature } =
    options;

  const region = resolveBedrockRegion();
  const modelId = model.requestModelId ?? model.id;
  const host = `bedrock-runtime.${region}.amazonaws.com`;
  const urlPath = `/model/${encodeURIComponent(modelId)}/converse-stream`;
  const url = `https://${host}${urlPath}`;

  const bedrockMessages = buildBedrockMessages(messages);
  const toolConfig = buildBedrockToolConfig(options);
  const body: Record<string, unknown> = {
    messages: bedrockMessages,
    inferenceConfig: {
      maxTokens: maxTokens ?? model.maxTokens ?? 4096,
      ...(temperature !== undefined ? { temperature } : {}),
    },
    ...(systemPrompt ? { system: [{ text: systemPrompt }] } : {}),
    ...(toolConfig ? { toolConfig } : {}),
  };

  const bodyText = JSON.stringify(body);
  const bodyBytes = new TextEncoder().encode(bodyText);
  const baseHeaders: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/vnd.amazon.eventstream',
  };

  // Bedrock's real credential authority is the ambient AWS credential chain
  // (SigV4-signed below), not a PLUMB-managed api_key -- `options.apiKey`
  // here carries whatever sentinel PLUMB's generic credential plumbing
  // fills in for an env-only provider (never a real Bedrock secret), so it
  // is deliberately never used as a Bearer token. The one legitimate
  // Bearer-auth override for Bedrock is AWS_BEARER_TOKEN_BEDROCK (or the
  // equivalent PLUMB-saved config value), matching the upstream OMP
  // Bedrock provider's own precedence.
  const bearerToken = resolveProviderConfigValue(
    BEDROCK_PROVIDER_ID,
    'bearerToken',
    'AWS_BEARER_TOKEN_BEDROCK',
  );

  let requestHeaders: Record<string, string>;
  const profile = resolveBedrockProfile();
  if (bearerToken) {
    requestHeaders = { ...baseHeaders, Authorization: `Bearer ${bearerToken}` };
  } else {
    let credentials;
    try {
      credentials = await resolveAwsCredentials({ profile, region, signal });
    } catch (err) {
      yield {
        type: 'error',
        error: {
          code: 'AUTH_REQUIRED',
          message:
            err instanceof Error
              ? err.message
              : 'Unable to resolve AWS credentials for Bedrock.',
        },
      };
      return;
    }
    const signed = await signRequest({
      method: 'POST',
      host,
      path: urlPath,
      body: bodyBytes,
      region,
      service: 'bedrock',
      credentials,
      headers: baseHeaders,
    });
    requestHeaders = { ...baseHeaders, ...signed };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: bodyBytes,
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
    if (!bearerToken && (response.status === 401 || response.status === 403)) {
      invalidateAwsCredentialCache({ profile, region });
    }
    const errorText = await response.text().catch(() => '');
    yield {
      type: 'error',
      error: classifyBedrockHttpError(response.status, errorText),
    };
    return;
  }

  if (!response.body) {
    yield {
      type: 'error',
      error: { code: 'NO_RESPONSE_BODY', message: 'No response body' },
    };
    return;
  }

  const toolNamesById = new Map<number, { id: string; name: string }>();
  let finishReason = 'stop';

  try {
    for await (const message of decodeEventStream(response.body)) {
      if (signal?.aborted) {
        yield { type: 'done', finishReason: 'cancelled' };
        return;
      }

      const messageType = message.headers[':message-type'];
      const eventType = message.headers[':event-type'];

      if (messageType === 'exception' || messageType === 'error') {
        const decoded = new TextDecoder().decode(message.payload);
        let errMessage = decoded;
        try {
          const parsed = JSON.parse(decoded) as { message?: string };
          if (parsed.message) errMessage = parsed.message;
        } catch {
          // Non-JSON payload -- use the raw decoded text.
        }
        yield {
          type: 'error',
          error: {
            code:
              message.headers[':exception-type'] ??
              message.headers[':error-code'] ??
              'UPSTREAM_ERROR',
            message: errMessage,
          },
        };
        return;
      }
      if (messageType !== 'event') continue;
      if (message.payload.length === 0) continue;

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(new TextDecoder().decode(message.payload));
      } catch {
        continue;
      }

      switch (eventType) {
        case 'contentBlockStart': {
          const start = payload['start'] as
            | { toolUse?: { toolUseId?: string; name?: string } }
            | undefined;
          const index = payload['contentBlockIndex'] as number;
          if (start?.toolUse?.toolUseId && start.toolUse.name) {
            toolNamesById.set(index, {
              id: start.toolUse.toolUseId,
              name: start.toolUse.name,
            });
          }
          break;
        }
        case 'contentBlockDelta': {
          const delta = payload['delta'] as
            | { text?: string; toolUse?: { input?: string } }
            | undefined;
          const index = payload['contentBlockIndex'] as number;
          if (delta?.text) {
            yield { type: 'text', text: delta.text };
          }
          if (delta?.toolUse?.input !== undefined) {
            const info = toolNamesById.get(index);
            yield {
              type: 'tool_call',
              toolCall: {
                id: info?.id ?? `call_${index}`,
                name: info?.name ?? '',
                arguments: delta.toolUse.input,
              },
            };
          }
          break;
        }
        case 'messageStop': {
          const reason = payload['stopReason'] as string | undefined;
          finishReason =
            reason === 'tool_use'
              ? 'tool_calls'
              : reason === 'max_tokens'
                ? 'length'
                : (reason ?? 'stop');
          break;
        }
        case 'metadata': {
          const usage = payload['usage'] as
            | {
                inputTokens?: number;
                outputTokens?: number;
                totalTokens?: number;
                cacheReadInputTokens?: number;
                cacheWriteInputTokens?: number;
              }
            | undefined;
          if (usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: usage.inputTokens ?? 0,
                outputTokens: usage.outputTokens ?? 0,
                totalTokens:
                  usage.totalTokens ??
                  (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
              },
            };
          }
          break;
        }
        default:
          // messageStart / contentBlockStop / unknown future events: no-op.
          break;
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
  }

  yield { type: 'done', finishReason };
}

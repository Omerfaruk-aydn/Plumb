/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { WatsonXAI } from '@ibm-cloud/watsonx-ai';
import { IamAuthenticator } from 'ibm-cloud-sdk-core';
import type { PlumbStreamEvent, PlumbStreamOptions } from '../types.js';
import { buildOpenAIMessages } from './streaming.js';
import { resolveProviderConfigValue } from '../config/providerConfigResolver.js';

const WATSONX_PROVIDER_ID = 'watsonx';

/** Official watsonx.ai API version query parameter used in IBM's own examples. */
const API_VERSION = '2024-05-31';

/** Real regional service hosts (see the official Node SDK's parameterized service URL). */
const REGION_HOSTS: Readonly<Record<string, string>> = {
  'us-south': 'https://us-south.ml.cloud.ibm.com',
  'eu-de': 'https://eu-de.ml.cloud.ibm.com',
  'eu-gb': 'https://eu-gb.ml.cloud.ibm.com',
  'jp-tok': 'https://jp-tok.ml.cloud.ibm.com',
  'au-syd': 'https://au-syd.ml.cloud.ibm.com',
  'ca-tor': 'https://ca-tor.ml.cloud.ibm.com',
};
const DEFAULT_REGION = 'us-south';

export function resolveWatsonxServiceUrl(): string {
  const region =
    resolveProviderConfigValue(
      WATSONX_PROVIDER_ID,
      'region',
      'WATSONX_REGION',
      DEFAULT_REGION,
    ) ?? DEFAULT_REGION;
  return REGION_HOSTS[region] ?? REGION_HOSTS[DEFAULT_REGION]!;
}

export interface WatsonxContext {
  projectId?: string;
  spaceId?: string;
}

/**
 * Either `project_id` or `space_id` is required by the API (mutually
 * exclusive execution contexts, not both) — see TextChatParams in the
 * official SDK types. Prefers project_id when both are set, since project
 * is the more common interactive-development context; space is normally
 * used for deployed/production assets.
 */
export function resolveWatsonxContext(): WatsonxContext {
  const projectId = resolveProviderConfigValue(
    WATSONX_PROVIDER_ID,
    'projectId',
    'WATSONX_PROJECT_ID',
  );
  const spaceId = resolveProviderConfigValue(
    WATSONX_PROVIDER_ID,
    'spaceId',
    'WATSONX_SPACE_ID',
  );
  return {
    projectId: projectId || undefined,
    spaceId: !projectId && spaceId ? spaceId : undefined,
  };
}

/**
 * watsonx.ai's TextChatMessages wire format (see the official SDK's
 * messages.d.ts) is OpenAI Chat-Completions-shaped: assistant messages
 * carry `tool_calls: [{id, type: 'function', function: {name, arguments}}]`,
 * tool-result messages carry `{role: 'tool', content, tool_call_id}`. This
 * reuses streaming.ts's buildOpenAIMessages() directly rather than a
 * second, watsonx-specific reimplementation of the exact same
 * tool-call/tool-result reconstruction logic.
 */
function buildMessages(options: PlumbStreamOptions): Record<string, unknown>[] {
  return buildOpenAIMessages(options.messages, options.systemPrompt);
}

interface WatsonxTool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

function buildTools(options: PlumbStreamOptions): WatsonxTool[] | undefined {
  if (
    !options.tools ||
    options.tools.length === 0 ||
    options.toolChoice?.mode === 'none'
  )
    return undefined;
  return options.tools.map((t) => ({
    type: 'function',
    function: t.function,
  }));
}

let cachedClient: {
  client: WatsonXAI;
  apiKey: string;
  serviceUrl: string;
} | null = null;

/**
 * Builds (and caches) the official SDK client. Cached by (apiKey,
 * serviceUrl) pair so a credential/region change on the next call
 * transparently constructs a fresh client rather than silently reusing a
 * stale IamAuthenticator bound to a different key.
 */
function getClient(apiKey: string, serviceUrl: string): WatsonXAI {
  if (
    cachedClient &&
    cachedClient.apiKey === apiKey &&
    cachedClient.serviceUrl === serviceUrl
  ) {
    return cachedClient.client;
  }
  const client = WatsonXAI.newInstance({
    version: API_VERSION,
    serviceUrl,
    authenticator: new IamAuthenticator({ apikey: apiKey }),
  });
  cachedClient = { client, apiKey, serviceUrl };
  return client;
}

/** Reset the cached client — test-only. */
export function __resetWatsonxClientCacheForTests(): void {
  cachedClient = null;
}

function classifyWatsonxError(err: unknown): {
  code: string;
  message: string;
} {
  const status = (err as { status?: number })?.status;
  const message =
    (err as { message?: string })?.message ?? 'watsonx.ai request failed';
  if (status === 401 || status === 403) {
    return { code: 'AUTH_REQUIRED', message };
  }
  if (status === 404) {
    return { code: 'MODEL_NOT_AVAILABLE', message };
  }
  if (status === 429) {
    return { code: 'RATE_LIMITED', message };
  }
  if (status === 422 || status === 400) {
    return { code: 'INVALID_REQUEST', message };
  }
  if (typeof status === 'number' && status >= 500) {
    return { code: 'UPSTREAM_ERROR', message };
  }
  return { code: 'NETWORK_ERROR', message };
}

/**
 * Streams an IBM watsonx.ai chat turn through the official SDK.
 *
 * Requires WATSONX_PROJECT_ID or WATSONX_SPACE_ID to be set (ambient env
 * config, not a credential); yields an explicit INVALID_REQUEST error
 * event rather than sending a request IBM's API would reject outright if
 * neither is present.
 */
export async function* streamWatsonx(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const { projectId, spaceId } = resolveWatsonxContext();
  if (!projectId && !spaceId) {
    yield {
      type: 'error',
      error: {
        code: 'INVALID_REQUEST',
        message:
          'IBM watsonx.ai requires WATSONX_PROJECT_ID or WATSONX_SPACE_ID to be set.',
      },
    };
    return;
  }
  if (!options.apiKey) {
    yield {
      type: 'error',
      error: {
        code: 'AUTH_REQUIRED',
        message: 'No IBM Cloud API key configured for watsonx.ai.',
      },
    };
    return;
  }

  const serviceUrl = resolveWatsonxServiceUrl();
  const client = getClient(options.apiKey, serviceUrl);
  const messages = buildMessages(options);
  const tools = buildTools(options);

  let stream: AsyncIterable<{
    data: {
      choices: Array<{
        delta?: {
          content?: string;
          role?: string;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
  }>;
  try {
    stream = await client.textChatStream({
      modelId: options.model.requestModelId ?? options.model.id,
      messages: messages as unknown as Parameters<
        typeof client.textChatStream
      >[0]['messages'],
      projectId,
      spaceId,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      ...(tools
        ? {
            tools: tools as Parameters<
              typeof client.textChatStream
            >[0]['tools'],
          }
        : {}),
      returnObject: true,
      signal: options.signal,
    });
  } catch (err) {
    const { code, message } = classifyWatsonxError(err);
    yield { type: 'error', error: { code, message } };
    return;
  }

  let finishReason: string | undefined;
  const pendingToolCalls = new Map<
    number,
    { id?: string; name: string; arguments: string; emitted: boolean }
  >();
  function* takePendingToolCalls(): Generator<PlumbStreamEvent> {
    for (const [index, pending] of pendingToolCalls) {
      if (pending.emitted) continue;
      pending.emitted = true;
      yield {
        type: 'tool_call',
        toolCall: {
          id: pending.id ?? `call_${index}`,
          name: pending.name,
          arguments: pending.arguments,
        },
      };
    }
  }
  try {
    for await (const chunk of stream) {
      if (options.signal?.aborted) {
        for (const event of takePendingToolCalls()) yield event;
        yield { type: 'done', finishReason: 'cancelled' };
        return;
      }
      const choice = chunk.data.choices?.[0];
      if (choice?.delta?.content) {
        yield { type: 'text', text: choice.delta.content };
      }
      if (choice?.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          if (tc.function) {
            const index = tc.index ?? 0;
            const pending = pendingToolCalls.get(index) ?? {
              name: '',
              arguments: '',
              emitted: false,
            };
            if (tc.id) pending.id = tc.id;
            if (tc.function.name) pending.name += tc.function.name;
            if (tc.function.arguments)
              pending.arguments += tc.function.arguments;
            pendingToolCalls.set(index, pending);
          }
        }
      }
      if (choice?.finish_reason) {
        for (const event of takePendingToolCalls()) yield event;
        finishReason = choice.finish_reason;
      }
      if (chunk.data.usage) {
        const u = chunk.data.usage;
        yield {
          type: 'usage',
          usage: {
            inputTokens: u.prompt_tokens ?? 0,
            outputTokens: u.completion_tokens ?? 0,
            totalTokens:
              u.total_tokens ??
              (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
          },
        };
      }
    }
  } catch (err) {
    const { code, message } = classifyWatsonxError(err);
    yield { type: 'error', error: { code, message } };
    return;
  }

  for (const event of takePendingToolCalls()) yield event;
  yield { type: 'done', finishReason: finishReason ?? 'stop' };
}

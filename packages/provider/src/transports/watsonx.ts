/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * IBM watsonx.ai transport — official `@ibm-cloud/watsonx-ai` Node SDK
 * (pinned exact version, see package.json), never a hand-rolled HTTP client
 * or a generic OpenAI-compatible base-URL passthrough.
 *
 * CREDENTIAL AUTHORITY: PLUMB owns the long-lived credential (the IBM Cloud
 * API key, stored via PlumbSecureCredentialStore like every other api_key
 * provider). The SHORT-LIVED IAM bearer token is never PLUMB's concern —
 * `IamAuthenticator` (from `ibm-cloud-sdk-core`, a dependency of the
 * official SDK) exchanges the API key for a bearer token against IBM's
 * real token endpoint (https://iam.cloud.ibm.com/identity/token, grant
 * type `urn:ibm:params:oauth:grant-type:apikey`) and transparently
 * refreshes it before expiry on every SDK call. PLUMB never stores, logs,
 * or exposes that ephemeral token.
 *
 * REGION / PROJECT / SPACE: watsonx.ai has no single global endpoint —
 * requests are regional (`https://{region}.ml.cloud.ibm.com`) and require
 * a project or space context (`WATSONX_PROJECT_ID` / `WATSONX_SPACE_ID`).
 * These are ambient environment-variable configuration, the same pattern
 * already used for Azure OpenAI's resource/deployment names and Amazon
 * Bedrock's AWS_REGION — not credentials, and not overloaded onto the
 * model id or provider id.
 *
 * SCOPE (v1, deliberately conservative — matches the same pattern already
 * used for claude-subscription this session): text + streaming + system
 * prompt + multi-turn history + usage + cancellation. Tool/function
 * calling is NOT wired yet — IBM's own API reference documents
 * `tool_choice_option: auto` and `required` as "not yet supported" (only
 * `none` is fully supported today), so wiring PLUMB's generic tool-calling
 * path onto an upstream capability IBM itself flags as incomplete would
 * risk silent, upstream-caused failures. Tools remain a documented,
 * explicit follow-up, not silently dropped without a trace.
 *
 * Official docs referenced: IBM Cloud IAM token exchange
 * (https://cloud.ibm.com/docs/account?topic=account-iamtoken_from_apikey),
 * watsonx.ai text chat API (https://cloud.ibm.com/apidocs/watsonx-ai),
 * and the official Node SDK reference
 * (https://ibm.github.io/watsonx-ai-node-sdk/).
 */

import { WatsonXAI } from '@ibm-cloud/watsonx-ai';
import { IamAuthenticator } from 'ibm-cloud-sdk-core';
import type { PlumbStreamEvent, PlumbStreamOptions } from '../types.js';

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
  const region = process.env['WATSONX_REGION']?.trim() || DEFAULT_REGION;
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
  const projectId = process.env['WATSONX_PROJECT_ID']?.trim();
  const spaceId = process.env['WATSONX_SPACE_ID']?.trim();
  return {
    projectId: projectId || undefined,
    spaceId: !projectId && spaceId ? spaceId : undefined,
  };
}

interface WatsonxChatMessage {
  role: string;
  content: string;
}

function buildMessages(options: PlumbStreamOptions): WatsonxChatMessage[] {
  const messages: WatsonxChatMessage[] = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  for (const msg of options.messages) {
    // Tool-role history is intentionally skipped in this v1 scope — see
    // module doc (no tool-calling wired yet, so there is never a real
    // tool-result to replay here).
    if (msg.role === 'tool') continue;
    const text = typeof msg.content === 'string' ? msg.content : '';
    if (!text) continue;
    messages.push({ role: msg.role, content: text });
  }
  return messages;
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

  let stream: AsyncIterable<{
    data: {
      choices: Array<{
        delta?: { content?: string; role?: string };
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
      messages,
      projectId,
      spaceId,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      returnObject: true,
      signal: options.signal,
    });
  } catch (err) {
    const { code, message } = classifyWatsonxError(err);
    yield { type: 'error', error: { code, message } };
    return;
  }

  let finishReason: string | undefined;
  try {
    for await (const chunk of stream) {
      if (options.signal?.aborted) {
        yield { type: 'done', finishReason: 'cancelled' };
        return;
      }
      const choice = chunk.data.choices?.[0];
      if (choice?.delta?.content) {
        yield { type: 'text', text: choice.delta.content };
      }
      if (choice?.finish_reason) {
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

  yield { type: 'done', finishReason: finishReason ?? 'stop' };
}

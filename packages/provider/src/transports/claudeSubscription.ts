/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Claude Subscription transport — bridges PLUMB to Anthropic's official
 * Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, pinned to 0.1.77 for
 * zod@3 compatibility — see packages/provider/package.json).
 *
 * This is a DISTINCT provider/credential authority from `anthropic-api`
 * (packages/provider/src/omp-ai/registry/anthropic.ts + providers/anthropic.ts,
 * a direct Anthropic Developer Platform API key). Per Anthropic's official
 * policy (support.claude.com "Use the Claude Agent SDK with your Claude
 * plan", June 15 2026 update — "Claude Agent SDK, `claude -p`, and
 * third-party app usage still draw from your subscription's usage limits"),
 * the Agent SDK is the ONLY currently-sanctioned way for a third-party
 * client to draw on a Claude Pro/Max/Team/Enterprise subscription. PLUMB's
 * previous hand-rolled OAuth flow against Claude Code's own client id
 * (omp-ai/registry/anthropic.ts, port 54545 paste-code) is NOT that
 * mechanism and is blocked from selection — see BLOCKED_CLIENT_REGISTRATIONS
 * in catalog/providers.ts.
 *
 * CREDENTIAL AUTHORITY: the Agent SDK — which wraps the Claude Code CLI —
 * owns login/session state entirely (its own on-disk/keychain storage,
 * outside PLUMB's control). This module never reads Claude Code's private
 * credential files, never inspects OAuth tokens, and never persists
 * anything into PlumbSecureCredentialStore for this provider: doing so
 * would either fail (the SDK doesn't expose raw tokens) or require exactly
 * the kind of private-file scraping the project's terms rule forbids. This
 * is the intentional EXTERNAL_OFFICIAL_CREDENTIAL_AUTHORITY exception to
 * the single-PLUMB-secret-store rule.
 *
 * TOOL EXECUTION: deliberately disabled in this first pass (`tools: []`).
 * The SDK defaults to Claude Code's full built-in tool set (Bash, Read,
 * Edit, ...) when `tools` is omitted — passing `[]` is the SDK's documented
 * way to disable all built-in tools, which is required here: without it, a
 * user selecting this as a chat model would silently grant an agentic
 * subprocess real filesystem/shell access outside PLUMB's own tool
 * permission model, and PLUMB has no tool-execution-ownership arbitration
 * with the SDK's own agent loop yet (both systems could otherwise try to
 * run the "same" tool call, or the SDK could run one PLUMB never sees).
 * Wiring PLUMB-owned tools through the SDK's `mcpServers`/`canUseTool`
 * hooks is left for a follow-up once that ownership question has a single
 * answer.
 */

import type {
  PlumbModel,
  PlumbStreamEvent,
  PlumbStreamOptions,
} from '../types.js';

// ─── SDK types (structural subset — avoids a hard type-only dependency on
// the optional package so this file still type-checks when it isn't
// installed; the actual module is always loaded via dynamic import). ─────

interface SdkAccountInfo {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  tokenSource?: string;
  apiKeySource?: string;
}

interface SdkAssistantContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface SdkMessage {
  type: string;
  subtype?: string;
  content?: SdkAssistantContentBlock[];
  error?: string;
  result?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  isAuthenticating?: boolean;
  output?: string[];
}

interface SdkQuery extends AsyncGenerator<SdkMessage, void> {
  accountInfo?: () => Promise<SdkAccountInfo>;
  interrupt?: () => Promise<unknown>;
  close?: () => void;
}

interface ClaudeAgentSdkModule {
  query(params: {
    prompt: string;
    options?: Record<string, unknown>;
  }): SdkQuery;
}

let cachedSdkModule: ClaudeAgentSdkModule | null | undefined;

/**
 * Dynamically imports the optional Agent SDK dependency. Returns `null`
 * (never throws) when the package isn't installed — the caller maps that
 * to AGENT_SDK_UNAVAILABLE rather than crashing the provider registry.
 */
async function loadAgentSdk(): Promise<ClaudeAgentSdkModule | null> {
  if (cachedSdkModule !== undefined) return cachedSdkModule;
  try {
    const mod = (await import(
      '@anthropic-ai/claude-agent-sdk'
    )) as unknown as ClaudeAgentSdkModule;
    cachedSdkModule = mod;
  } catch {
    cachedSdkModule = null;
  }
  return cachedSdkModule;
}

/** Reset the module-level SDK cache — test-only. */
export function __resetClaudeAgentSdkCacheForTests(): void {
  cachedSdkModule = undefined;
}

// ─── Auth status ────────────────────────────────────────────────────────

export type ClaudeSubscriptionAuthStatus =
  | 'NOT_INSTALLED'
  | 'NOT_LOGGED_IN'
  | 'CONNECTED_SUBSCRIPTION'
  | 'SESSION_EXPIRED'
  | 'AGENT_SDK_UNAVAILABLE'
  | 'PLAN_UNSUPPORTED'
  | 'UPSTREAM_POLICY_CHANGED';

export interface ClaudeSubscriptionStatusResult {
  status: ClaudeSubscriptionAuthStatus;
  /** Safe, non-secret account metadata when available (never a token). */
  account?: {
    email?: string;
    organization?: string;
    subscriptionType?: string;
  };
  /** Human-readable detail for diagnostics/UI — never includes a secret. */
  detail?: string;
}

/**
 * Classifies the current Claude subscription connection state without
 * ever reading a credential file directly. Spawns a minimal, zero-tool,
 * zero-cost-intent probe through the official SDK and interprets its
 * response — the SDK/CLI remains the sole credential authority throughout.
 *
 * NOTE ON PRECISION: the Agent SDK's `SDKSystemMessage.apiKeySource` field
 * (`'user' | 'project' | 'org' | 'temporary'`) does not unambiguously say
 * "this session is billing your subscription" vs. "this session used an
 * API key" — Anthropic's own docs warn that an ambient `ANTHROPIC_API_KEY`
 * silently wins over an OAuth/subscription login. This function reports
 * `AccountInfo.subscriptionType` when the SDK provides it (the strongest
 * available signal) but does not claim CONNECTED_SUBSCRIPTION is
 * guaranteed to be subscription-billed beyond what the SDK itself reports.
 * Treat this as READY_FOR_USER_TEST, not REAL_VERIFIED, until confirmed
 * against a real account.
 */
export async function getClaudeSubscriptionStatus(): Promise<ClaudeSubscriptionStatusResult> {
  const sdk = await loadAgentSdk();
  if (!sdk) {
    return {
      status: 'AGENT_SDK_UNAVAILABLE',
      detail: '@anthropic-ai/claude-agent-sdk is not installed',
    };
  }

  let query: SdkQuery;
  try {
    query = sdk.query({
      prompt: '',
      options: {
        tools: [],
        maxTurns: 0,
      },
    });
  } catch (err) {
    return classifyStatusError(err);
  }

  try {
    const accountInfo = await query.accountInfo?.();
    if (!accountInfo) {
      return { status: 'NOT_LOGGED_IN' };
    }
    if (!accountInfo.subscriptionType) {
      // Authenticated (the SDK returned account identity), but no
      // subscription plan attached — most likely an API-key-only session,
      // which this provider must not silently accept as subscription auth.
      return {
        status: 'PLAN_UNSUPPORTED',
        account: {
          email: accountInfo.email,
          organization: accountInfo.organization,
        },
        detail: 'No subscription plan reported for this Claude account',
      };
    }
    return {
      status: 'CONNECTED_SUBSCRIPTION',
      account: {
        email: accountInfo.email,
        organization: accountInfo.organization,
        subscriptionType: accountInfo.subscriptionType,
      },
    };
  } catch (err) {
    return classifyStatusError(err);
  } finally {
    query.close?.();
  }
}

/**
 * Text-pattern classification for an error thrown by the SDK, shared by
 * both the query-construction and the accountInfo() failure paths. When no
 * pattern matches, this is genuinely uncertain — NOT_LOGGED_IN is the safe
 * default (it triggers a re-auth prompt rather than silently reporting the
 * SDK as absent).
 */
function classifyStatusError(err: unknown): ClaudeSubscriptionStatusResult {
  const message = (err as Error).message ?? '';
  if (/not.{0,10}(installed|found)/i.test(message)) {
    return { status: 'NOT_INSTALLED', detail: message };
  }
  if (/auth|login|unauthenticated|401/i.test(message)) {
    return { status: 'NOT_LOGGED_IN', detail: message };
  }
  if (/expired|session/i.test(message)) {
    return { status: 'SESSION_EXPIRED', detail: message };
  }
  if (/policy|forbidden|terms|not.{0,10}permitted/i.test(message)) {
    return { status: 'UPSTREAM_POLICY_CHANGED', detail: message };
  }
  return { status: 'NOT_LOGGED_IN', detail: message };
}

// ─── Pinned model metadata (OFFICIAL_STATIC_METADATA — no live discovery
// endpoint exists for Claude subscription models today) ──────────────────

export interface ClaudeSubscriptionModelMetadata {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  source: 'OFFICIAL_STATIC_METADATA';
}

/**
 * Pinned model aliases the Agent SDK accepts for `options.model`. Not a
 * dynamic catalog — Anthropic does not expose a live model-list endpoint
 * for Claude subscription sessions the way the Developer Platform API
 * does. Update this list from official Claude Code release notes when
 * model aliases change; never claim `model.source = ACCOUNT_DYNAMIC` here.
 */
export const CLAUDE_SUBSCRIPTION_MODELS: readonly ClaudeSubscriptionModelMetadata[] =
  [
    {
      id: 'claude-opus-4-8',
      name: 'Claude Opus 4.8',
      contextWindow: 200_000,
      maxTokens: 32_000,
      reasoning: true,
      source: 'OFFICIAL_STATIC_METADATA',
    },
    {
      id: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
      contextWindow: 200_000,
      maxTokens: 64_000,
      reasoning: true,
      source: 'OFFICIAL_STATIC_METADATA',
    },
  ];

// ─── Streaming transport ────────────────────────────────────────────────

function formatTranscriptPrompt(options: PlumbStreamOptions): string {
  const lines: string[] = [];
  if (options.systemPrompt) {
    lines.push(`[system]\n${options.systemPrompt}`);
  }
  for (const msg of options.messages) {
    if (msg.role === 'system') continue;
    const text = typeof msg.content === 'string' ? msg.content : '';
    if (!text) continue;
    lines.push(`[${msg.role}]\n${text}`);
  }
  return lines.join('\n\n');
}

/**
 * Streams a Claude subscription turn through the official Agent SDK.
 *
 * SCOPE (v1, deliberately conservative — see module doc): every call is an
 * independent `query()`, not a resumed SDK session — the full PLUMB
 * message history is serialized into the initial prompt (the same
 * stateless-per-call contract every other transport in this file uses),
 * rather than adopting the SDK's own session/`resume` state. This forfeits
 * some SDK-side efficiency but requires no new persistent-session-id
 * plumbing in plumbContentGenerator.ts. Tools are hard-disabled
 * (`tools: []`) — see module doc for why.
 */
export async function* streamClaudeSubscription(
  options: PlumbStreamOptions,
): AsyncGenerator<PlumbStreamEvent> {
  const sdk = await loadAgentSdk();
  if (!sdk) {
    yield {
      type: 'error',
      error: {
        code: 'AGENT_SDK_UNAVAILABLE',
        message:
          '@anthropic-ai/claude-agent-sdk is not installed. Claude Subscription requires the official Agent SDK.',
      },
    };
    return;
  }

  const model = resolveSdkModelId(options.model);
  const prompt = formatTranscriptPrompt(options);

  let query: SdkQuery;
  try {
    query = sdk.query({
      prompt,
      options: {
        model,
        tools: [],
        abortController: toAbortController(options.signal),
        maxTurns: 1,
      },
    });
  } catch (err) {
    yield {
      type: 'error',
      error: { code: 'AGENT_SDK_UNAVAILABLE', message: (err as Error).message },
    };
    return;
  }

  let finishReason: string | undefined;
  try {
    for await (const message of query) {
      if (options.signal?.aborted) {
        yield { type: 'done', finishReason: 'cancelled' };
        return;
      }
      switch (message.type) {
        case 'assistant': {
          for (const block of message.content ?? []) {
            if (block.type === 'text' && block.text) {
              yield { type: 'text', text: block.text };
            } else if (block.type === 'thinking' && block.thinking) {
              yield { type: 'thinking', thinkingText: block.thinking };
            }
            // tool_use blocks are intentionally not surfaced — tools are
            // disabled for this transport (see module doc); a tool_use
            // block should not appear with `tools: []`, but if the SDK
            // ever emits one anyway, silently dropping it (rather than
            // executing it) is the safe failure mode.
          }
          if (message.error) {
            yield {
              type: 'error',
              error: {
                code: classifyAssistantError(message.error),
                message: message.error,
              },
            };
            return;
          }
          break;
        }
        case 'result': {
          if (message.usage) {
            const inputTokens = message.usage.input_tokens ?? 0;
            const outputTokens = message.usage.output_tokens ?? 0;
            yield {
              type: 'usage',
              usage: {
                inputTokens,
                outputTokens,
                cacheReadInputTokens: message.usage.cache_read_input_tokens,
                cacheCreationInputTokens:
                  message.usage.cache_creation_input_tokens,
                totalTokens: inputTokens + outputTokens,
              },
            };
          }
          finishReason =
            message.subtype === 'success' ? 'stop' : message.subtype;
          break;
        }
        default:
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
  } finally {
    query.close?.();
  }

  yield { type: 'done', finishReason };
}

function classifyAssistantError(error: string): string {
  const known = new Set([
    'authentication_failed',
    'billing_error',
    'rate_limit',
    'invalid_request',
    'server_error',
  ]);
  // SDKAssistantMessageError is a closed, documented union; a value outside
  // it is still a real SDK-reported classification, not a guess, so it's
  // kept verbatim rather than collapsed to a generic code.
  if (known.has(error)) {
    switch (error) {
      case 'authentication_failed':
        return 'AUTH_REQUIRED';
      case 'billing_error':
        return 'ACCOUNT_RESTRICTED';
      case 'rate_limit':
        return 'RATE_LIMITED';
      case 'invalid_request':
        return 'INVALID_REQUEST';
      case 'server_error':
        return 'UPSTREAM_ERROR';
      default:
        return error;
    }
  }
  return error;
}

function toAbortController(signal?: AbortSignal): AbortController | undefined {
  if (!signal) return undefined;
  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener('abort', () => controller.abort(), {
      once: true,
    });
  }
  return controller;
}

function resolveSdkModelId(model: PlumbModel): string {
  return model.requestModelId ?? model.id;
}

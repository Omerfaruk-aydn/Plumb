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

import { z } from 'zod';
import type {
  PlumbModel,
  PlumbStreamEvent,
  PlumbStreamOptions,
  PlumbTool,
  PlumbToolExecutor,
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

/** Structural subset of the SDK's documented CallToolResult shape. */
interface SdkCallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Structural subset of the SDK's documented tool()/createSdkMcpServer() API. */
interface SdkMcpServerConfigWithInstance {
  type: 'sdk';
  name: string;
  instance: unknown;
}

interface ClaudeAgentSdkModule {
  query(params: {
    prompt: string;
    options?: Record<string, unknown>;
  }): SdkQuery;
  /**
   * Optional — present on SDK builds that support in-process MCP custom
   * tools (the mechanism this module uses to give PLUMB sole tool-execution
   * authority; see buildPlumbMcpServer below). Structurally optional so
   * this file still type-checks against older/partial mocks.
   */
  tool?(
    name: string,
    description: string,
    inputSchema: Record<string, z.ZodTypeAny>,
    handler: (
      args: Record<string, unknown>,
      extra: unknown,
    ) => Promise<SdkCallToolResult>,
  ): unknown;
  createSdkMcpServer?(options: {
    name: string;
    version?: string;
    tools?: unknown[];
  }): SdkMcpServerConfigWithInstance;
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

// ─── Tool authority bridge (PLUMB owns execution) ──────────────────────
//
// CLAUDE_SUBSCRIPTION_TOOL_AUTHORITY: PLUMB_CORE_TOOL_SCHEDULER
//
// The Agent SDK's built-in tool set stays permanently disabled (`tools: []`
// in streamClaudeSubscription below) — that invariant is unconditional and
// does not depend on whether a caller wires a tool executor. Instead, when
// a caller supplies both `options.tools` (a non-empty PlumbTool[], already
// the exact same list every other transport in this codebase builds its
// native tool-calling params from) AND `options.toolExecutor` (the
// dependency-inverted seam a `packages/core` caller uses to route into the
// real, single CoreToolScheduler-backed execution pipeline — see
// PlumbToolExecutor in types.ts), this module registers those tools as an
// in-process MCP server via the SDK's own documented `tool()` /
// `createSdkMcpServer()` / `options.mcpServers` mechanism (structurally
// distinct from `options.tools`, which only ever toggles the SDK's
// *built-in* Bash/Read/Edit/... tool set).
//
// This file NEVER executes a tool itself. Every MCP tool handler below
// does exactly one thing: translate the SDK's call into a
// PlumbToolExecutionRequest, await exactly one call to the caller-supplied
// executor, and translate the PlumbToolExecutionResult back into the SDK's
// documented CallToolResult shape. It is an ADAPTER, not an executor —
// there must remain exactly one implementation of any given tool (owned by
// `packages/core`'s real tool registry/scheduler), never a
// Claude-subscription-specific reimplementation.

/**
 * Minimal, deterministic JSON-Schema -> Zod-raw-shape converter for the
 * common shapes PLUMB's own tool `parameters` objects actually use (a
 * top-level object schema with typed properties). This exists ONLY so the
 * Agent SDK's `tool()` call has a schema to show the model — it is NOT the
 * authoritative validation boundary. The real CoreToolScheduler pipeline
 * (reached via the injected executor) performs the actual, authoritative
 * parameter validation against the tool's real JSON Schema; a property this
 * converter cannot faithfully represent degrades to `z.unknown()` rather
 * than silently narrowing/rejecting it, so real validation is never
 * weakened or duplicated here — only the model's up-front guidance is.
 */
function jsonSchemaPropertyToZod(schema: unknown): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.unknown();
  const s = schema as Record<string, unknown>;
  switch (s['type']) {
    case 'string':
      return Array.isArray(s['enum']) && s['enum'].length > 0
        ? z.enum(s['enum'] as [string, ...string[]])
        : z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(jsonSchemaPropertyToZod(s['items']));
    case 'object': {
      const shape = jsonSchemaToZodShape(s);
      return z.object(shape);
    }
    default:
      return z.unknown();
  }
}

function jsonSchemaToZodShape(
  parameters: Record<string, unknown> | undefined,
): z.ZodRawShape {
  const shape: z.ZodRawShape = {};
  const properties = parameters?.['properties'];
  if (!properties || typeof properties !== 'object') return shape;
  const required = new Set(
    Array.isArray(parameters?.['required'])
      ? (parameters['required'] as unknown[]).filter(
          (r): r is string => typeof r === 'string',
        )
      : [],
  );
  for (const [key, propSchema] of Object.entries(
    properties as Record<string, unknown>,
  )) {
    const zodType = jsonSchemaPropertyToZod(propSchema);
    shape[key] = required.has(key) ? zodType : zodType.optional();
  }
  return shape;
}

/**
 * Converts one PlumbToolExecutionResult into the SDK's documented
 * CallToolResult shape. Never exposes raw internal error objects/stack
 * traces — `result.content` is already the safe, human-readable text the
 * executor produced.
 */
function toSdkCallToolResult(
  result: import('../types.js').PlumbToolExecutionResult,
): SdkCallToolResult {
  return {
    content: [{ type: 'text', text: result.content }],
    isError: result.isError,
  };
}

/**
 * Builds the in-process MCP server that gives PLUMB (via `executor`) sole
 * tool-execution authority for this Claude Subscription turn. Returns
 * `undefined` when the SDK build doesn't expose `tool()`/`createSdkMcpServer`
 * (older/partial installs) or there are no tools to register — callers
 * must treat that as "no tools this turn", never fall back to enabling the
 * SDK's own built-in tools.
 */
function buildPlumbMcpServer(
  sdk: ClaudeAgentSdkModule,
  tools: PlumbTool[],
  executor: PlumbToolExecutor,
): SdkMcpServerConfigWithInstance | undefined {
  if (!sdk.tool || !sdk.createSdkMcpServer) return undefined;
  if (tools.length === 0) return undefined;

  const sdkTools = tools.map((plumbTool) => {
    const shape = jsonSchemaToZodShape(plumbTool.function.parameters);
    let callCounter = 0;
    return sdk.tool!(
      plumbTool.function.name,
      plumbTool.function.description,
      shape,
      async (args) => {
        // One MCP tool call -> one executor call -> one CallToolResult.
        // callCounter/name/args are the full identity of this single
        // invocation; the executor (packages/core) is solely responsible
        // for correlating it to a real CoreToolScheduler run.
        const toolCallId = `${plumbTool.function.name}:${callCounter++}`;
        const result = await executor({
          toolName: plumbTool.function.name,
          args,
          toolCallId,
        });
        return toSdkCallToolResult(result);
      },
    );
  });

  return sdk.createSdkMcpServer({
    name: 'plumb',
    tools: sdkTools as unknown[],
  });
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
 * plumbing in plumbContentGenerator.ts.
 *
 * TOOLS: the SDK's own built-in tool set is unconditionally disabled
 * (`tools: []`) — see module doc. PLUMB-owned tools are enabled only when
 * the caller supplies both `options.tools` (non-empty) and
 * `options.toolExecutor` (see buildPlumbMcpServer above); when neither is
 * present, this turn has no tools at all, exactly like every prior release.
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

  const mcpServer =
    options.tools && options.tools.length > 0 && options.toolExecutor
      ? buildPlumbMcpServer(sdk, options.tools, options.toolExecutor)
      : undefined;

  let query: SdkQuery;
  try {
    query = sdk.query({
      prompt,
      options: {
        model,
        // SDK built-in tools (Bash, Read, Edit, ...) stay disabled
        // unconditionally — PLUMB tools (if any) are registered exclusively
        // through mcpServers below, never through this field.
        tools: [],
        ...(mcpServer
          ? { mcpServers: { plumb: mcpServer }, maxTurns: 10 }
          : { maxTurns: 1 }),
        abortController: toAbortController(options.signal),
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

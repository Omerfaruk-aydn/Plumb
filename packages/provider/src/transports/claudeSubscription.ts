/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
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
  /**
   * Assistant content blocks. The pinned Agent SDK (0.1.77,
   * SDKAssistantMessage in sdk.d.ts) nests the API assistant message under
   * `message` — so the authoritative location is `message.message.content`,
   * NOT a top-level `content`. Reading the top level (an earlier revision
   * of this file did) silently drops every text block of every real SDK
   * response: the stream then "completes" with usage+done but no text,
   * which is exactly the live-observed false failure this structural
   * subset now encodes correctly. The top-level field is only tolerated as
   * a fallback for older/partial SDK builds.
   */
  message?: { content?: SdkAssistantContentBlock[] };
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
    // CRITICAL INVARIANT — ANTHROPIC cache_control SAFETY:
    //
    // Anthropic's API rejects every request that attaches `cache_control`
    // to a zero-length text content block (HTTP 400 `cache_control cannot
    // be set for empty text blocks`). The Agent SDK auto-attaches a
    // `cache_control: { type: "ephemeral" }` breakpoint to the LAST
    // text content block it ships, so a literal `prompt: ''` becomes a
    // user message with content: [{ type: 'text', text: '' }] carrying
    // cache_control → the exact failure reported on the first
    // interactive PLUMB turn. We must never feed the SDK a zero-length
    // prompt. The status probe here only reads `accountInfo()` and never
    // iterates the prompt stream, so a single non-empty ASCII placeholder
    // char is both safe (never reaches the model) and required (keeps
    // the SDK's outbound message non-empty and cache_control-legal).
    // Same rationale as `getClaudeSubscriptionModels`'s PROBE_PROMPT
    // — a single non-whitespace ASCII char that survives any
    // SDK-side trim/normalize pass.
    query = sdk.query({
      prompt: 'p',
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

// ─── Re-authentication (official Claude CLI hand-off) ──────────────────
//
// The Agent SDK exposes no login/auth function of its own (checked:
// entrypoints/agentSdkTypes.d.ts only exports `tool`, `createSdkMcpServer`,
// `query`, `AbortError`, `unstable_v2_*` — nothing auth-related). The
// package it wraps DOES bundle the real Claude Code CLI (`cli.js`), whose
// documented `setup-token` subcommand ("Set up a long-lived authentication
// token (requires Claude subscription)") is the officially shipped,
// scriptable sign-in entry point. This is the ONLY mechanism this module
// invokes for re-authentication — no raw OAuth endpoint is ever contacted
// here, matching the module-level EXTERNAL_OFFICIAL_CREDENTIAL_AUTHORITY
// invariant above.

export interface ClaudeCliCommand {
  /** Executable to spawn — either the `claude` binary found on PATH, or `process.execPath` (node) when running the bundled cli.js. */
  command: string;
  args: string[];
  source: 'PATH' | 'BUNDLED_SDK';
}

/** Injectable process primitives so tests never spawn a real child process. */
export interface ClaudeCliProcessAdapter {
  /** Resolves a `claude` executable on PATH, or null if absent. Defaults to `where`/`which claude`. */
  findOnPath?: () => string | null;
  /** Resolves the absolute path to the bundled SDK's cli.js, or null if it can't be located. */
  resolveBundledCliJs?: () => Promise<string | null>;
  /** Spawns a command with inherited stdio and resolves with its exit code. Defaults to node:child_process spawn. */
  spawnInherit?: (
    command: string,
    args: string[],
    opts: { shell: boolean },
  ) => Promise<number | null>;
}

function defaultFindClaudeCliOnPath(): string | null {
  try {
    const isWin = process.platform === 'win32';
    const result = spawnSync(isWin ? 'where' : 'which', ['claude'], {
      encoding: 'utf8',
    });
    if (result.status === 0 && result.stdout) {
      const first = result.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      return first ?? null;
    }
  } catch {
    // PATH lookup itself failing (e.g. no `where`/`which` binary) just means
    // "not found on PATH" — fall through to the bundled-SDK path.
  }
  return null;
}

async function defaultResolveBundledCliJs(): Promise<string | null> {
  try {
    // As of @anthropic-ai/claude-agent-sdk@0.3.233 (upgraded from 0.1.77),
    // the package ships a strict `exports` map that does NOT include
    // `./package.json` -- resolving that subpath now throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED (0.1.77 had no `exports` field at all,
    // so any subpath resolved). Resolve the package's main entry ("." --
    // still exported, -> sdk.mjs) instead, which sits in the same
    // directory as cli.js, and derive the directory from THAT. Uses
    // `createRequire(...).resolve` rather than `import.meta.resolve`
    // because Vite's SSR transform (this module runs under it in vitest)
    // does not implement `import.meta.resolve`
    // (`__vite_ssr_import_meta__.resolve is not a function`), while
    // `node:module`'s createRequire is a plain Node builtin call Vite
    // passes through untouched.
    const nodeRequire = createRequire(import.meta.url);
    const mainEntryPath = nodeRequire.resolve('@anthropic-ai/claude-agent-sdk');
    const path = await import('node:path');
    return path.join(path.dirname(mainEntryPath), 'cli.js');
  } catch {
    return null;
  }
}

async function defaultSpawnInherit(
  command: string,
  args: string[],
  opts: { shell: boolean },
): Promise<number | null> {
  return await new Promise<number | null>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: opts.shell });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => resolve(code));
  });
}

/**
 * Resolves how to invoke the official Claude CLI: prefer a `claude` binary
 * already on PATH (the user's own Claude Code install, most likely to carry
 * the account/session the user expects), falling back to the exact CLI
 * bundled with PLUMB's pinned `@anthropic-ai/claude-agent-sdk` dependency —
 * never any other/invented binary.
 */
export async function resolveClaudeCliCommand(
  adapter: ClaudeCliProcessAdapter = {},
): Promise<ClaudeCliCommand | null> {
  const findOnPath = adapter.findOnPath ?? defaultFindClaudeCliOnPath;
  const resolveBundled =
    adapter.resolveBundledCliJs ?? defaultResolveBundledCliJs;

  const onPath = findOnPath();
  if (onPath) {
    return { command: onPath, args: [], source: 'PATH' };
  }
  const bundled = await resolveBundled();
  if (bundled) {
    return {
      command: process.execPath,
      args: [bundled],
      source: 'BUNDLED_SDK',
    };
  }
  return null;
}

export type ClaudeSubscriptionReauthOutcome =
  | 'COMPLETED'
  | 'CLI_NOT_FOUND'
  | 'SPAWN_FAILED'
  | 'NONZERO_EXIT';

export interface ClaudeSubscriptionReauthResult {
  outcome: ClaudeSubscriptionReauthOutcome;
  exitCode?: number | null;
  detail?: string;
}

/**
 * Runs the official Claude CLI's `setup-token` command interactively
 * (inherited stdio — the CLI owns the terminal for the duration, exactly
 * like PLUMB already does for `$EDITOR`), then returns honestly what
 * happened. Callers MUST re-probe `getClaudeSubscriptionStatus()` after this
 * resolves rather than inferring success from `outcome` alone — a zero exit
 * code is a strong signal but not a redundant guarantee, and a non-zero one
 * (e.g. the user backed out of the CLI's own prompt) doesn't necessarily
 * mean an existing session was invalidated.
 */
export async function runClaudeSubscriptionReauth(
  adapter: ClaudeCliProcessAdapter = {},
): Promise<ClaudeSubscriptionReauthResult> {
  const cli = await resolveClaudeCliCommand(adapter);
  if (!cli) {
    return {
      outcome: 'CLI_NOT_FOUND',
      detail:
        'The official Claude CLI was not found — neither on PATH nor bundled with the installed Agent SDK. Install Claude Code to sign in.',
    };
  }
  const spawnInherit = adapter.spawnInherit ?? defaultSpawnInherit;
  try {
    const code = await spawnInherit(cli.command, [...cli.args, 'setup-token'], {
      shell: process.platform === 'win32' && cli.source === 'PATH',
    });
    return code === 0
      ? { outcome: 'COMPLETED', exitCode: code }
      : { outcome: 'NONZERO_EXIT', exitCode: code };
  } catch (err) {
    return { outcome: 'SPAWN_FAILED', detail: (err as Error).message };
  }
}

// ─── Model metadata (pinned floor + account-aware discovery) ───────────

export interface ClaudeSubscriptionModelMetadata {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  source: 'OFFICIAL_STATIC_METADATA' | 'ACCOUNT_DYNAMIC';
  /**
   * Whether `contextWindow`/`maxTokens` above are a real, model-specific
   * pinned reference (`PINNED_REFERENCE`, from this file's
   * CLAUDE_SUBSCRIPTION_MODELS table) or the generic, non-model-specific
   * generation floor (`GENERIC_FLOOR`, CLAUDE_GENERATION_CONTEXT_WINDOW /
   * CLAUDE_UNKNOWN_MODEL_MAX_TOKENS_FLOOR) used only because a live-
   * discovered id had no matching table entry. Consumers (the universal
   * inventory) MUST NOT report a GENERIC_FLOOR value as the model's true
   * contextWindow/maxOutputTokens — it is a safety budget, not metadata.
   */
  limitsSource: 'PINNED_REFERENCE' | 'GENERIC_FLOOR';
}

/**
 * Pinned model aliases the Agent SDK accepts for `options.model`, used as
 * the floor `OFFICIAL_STATIC_METADATA` result whenever live discovery
 * (`getClaudeSubscriptionModels` below) is unavailable or fails. Update
 * this list from official Claude Code release notes when model aliases
 * change; never claim `source: 'ACCOUNT_DYNAMIC'` on an entry here.
 *
 * Ids below were updated (2026-08, alongside the 0.1.77 -> 0.3.233 Agent
 * SDK upgrade) to the real `resolvedModel` ids a live, authenticated
 * `query.supportedModels()` probe against this account actually returned
 * -- `claude-opus-4-8` (a pre-upgrade placeholder id) never appeared live
 * and is replaced by the real `claude-opus-5`. `claude-fable-5` and
 * `claude-haiku-4-5-20251001` are added as newly-confirmed real ids from
 * that same probe. contextWindow/maxTokens numbers are still the
 * documented Claude 4.x/5.x-generation platform floor, NOT independently
 * re-verified per model (supportedModels() does not return numeric
 * limits) -- only the ids themselves are live-confirmed.
 */
export const CLAUDE_SUBSCRIPTION_MODELS: readonly ClaudeSubscriptionModelMetadata[] =
  [
    {
      id: 'claude-opus-5',
      name: 'Claude Opus 5',
      contextWindow: 200_000,
      maxTokens: 32_000,
      reasoning: true,
      source: 'OFFICIAL_STATIC_METADATA',
      limitsSource: 'PINNED_REFERENCE',
    },
    {
      id: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
      contextWindow: 200_000,
      maxTokens: 64_000,
      reasoning: true,
      source: 'OFFICIAL_STATIC_METADATA',
      limitsSource: 'PINNED_REFERENCE',
    },
    {
      id: 'claude-fable-5',
      name: 'Claude Fable 5',
      contextWindow: 200_000,
      maxTokens: 32_000,
      reasoning: true,
      source: 'OFFICIAL_STATIC_METADATA',
      limitsSource: 'PINNED_REFERENCE',
    },
    {
      id: 'claude-haiku-4-5-20251001',
      name: 'Claude Haiku 4.5',
      contextWindow: 200_000,
      maxTokens: 16_000,
      reasoning: false,
      source: 'OFFICIAL_STATIC_METADATA',
      limitsSource: 'PINNED_REFERENCE',
    },
  ];

/**
 * Context window shared by every model currently in `CLAUDE_SUBSCRIPTION_MODELS`
 * — Anthropic's current platform-wide floor for the whole Claude 4.x
 * generation, not a per-model guess. Applied to a live-discovered model only
 * when its id has no specific known entry below.
 */
const CLAUDE_GENERATION_CONTEXT_WINDOW = 200_000;

/**
 * Conservative maxTokens floor for a live-discovered model whose id doesn't
 * match a known reference entry: the SMALLEST maxTokens among the pinned
 * references (currently Opus's 32,000), deliberately under- rather than
 * over-promising output capacity until real per-model metadata is known.
 * Never a guessed/invented number for a specific model.
 */
const CLAUDE_UNKNOWN_MODEL_MAX_TOKENS_FLOOR = Math.min(
  ...CLAUDE_SUBSCRIPTION_MODELS.map((m) => m.maxTokens),
);

export interface ClaudeSubscriptionModelsResult {
  models: readonly ClaudeSubscriptionModelMetadata[];
  /**
   * `ACCOUNT_DYNAMIC` when the models list itself came from the live,
   * authenticated SDK session (`query.supportedModels()` — account/plan
   * aware, reflects what THIS account can actually use); `OFFICIAL_STATIC_METADATA`
   * when discovery was unavailable/failed and the pinned floor was used
   * instead. Per-entry `source` may still differ (see ClaudeSubscriptionModelMetadata).
   */
  source: 'ACCOUNT_DYNAMIC' | 'OFFICIAL_STATIC_METADATA';
}

/**
 * Discovers the models the CURRENT authenticated Claude subscription
 * session can actually use, via the pinned Agent SDK's documented
 * `Query.supportedModels()` (`node_modules/@anthropic-ai/claude-agent-sdk/
 * entrypoints/sdk/runtimeTypes.d.ts`: "Get the list of available models" —
 * populated from the live CLI subprocess's own session-init handshake with
 * Anthropic's backend, so it reflects the real account/plan, not a guess).
 * This supersedes an earlier module comment claiming no such discovery
 * exists; the pinned SDK's own type surface says otherwise.
 *
 * Numeric context/output metadata for a live-discovered id is filled from
 * `CLAUDE_SUBSCRIPTION_MODELS` when the id matches a known entry exactly;
 * for a genuinely new id neither table has real numbers for, this uses
 * documented, non-fabricated floors (see CLAUDE_GENERATION_CONTEXT_WINDOW /
 * CLAUDE_UNKNOWN_MODEL_MAX_TOKENS_FLOOR) rather than inventing a number —
 * the model's existence is never fabricated (it came from the live
 * account), only its exact numeric limits may be conservative estimates
 * until this file's pinned reference table is updated.
 *
 * Falls back to `CLAUDE_SUBSCRIPTION_MODELS` (OFFICIAL_STATIC_METADATA)
 * whenever the SDK is unavailable, the probe query fails, `supportedModels`
 * is absent/throws, or it returns an empty list — the returned model count
 * never drops below today's pinned floor.
 */
export async function getClaudeSubscriptionModels(): Promise<ClaudeSubscriptionModelsResult> {
  const sdk = await loadAgentSdk();
  if (!sdk) {
    return {
      models: CLAUDE_SUBSCRIPTION_MODELS,
      source: 'OFFICIAL_STATIC_METADATA',
    };
  }

  let query: SdkQuery | undefined;
  try {
    // CRITICAL INVARIANT — ANTHROPIC cache_control SAFETY:
    //
    // Anthropic's API rejects every request that attaches `cache_control` to
    // a zero-length text content block (HTTP 400 `cache_control cannot be
    // set for empty text blocks`). The Agent SDK auto-attaches a
    // `cache_control: { type: "ephemeral" }` breakpoint to the LAST text
    // content block it ships, so a literal `prompt: ''` becomes a user
    // message with content: [{ type: 'text', text: '' }] carrying
    // cache_control → the exact failure reported on the first interactive
    // PLUMB turn. We must never feed the SDK a zero-length prompt; the
    // discovery probe here only reads `supportedModels()` and never iterates
    // the prompt stream, so a single non-empty placeholder char is both
    // safe (never reaches the model) and required (keeps the SDK's
    // outbound message non-empty and cache_control-legal).
    //
    // We use a single ASCII char "p" — short, non-whitespace, survives
    // any reasonable SDK-side trim/normalize pass, and is meaningless
    // to the model (the SDK never iterates the prompt because
    // `maxTurns: 0` short-circuits before any assistant turn is
    // generated). A real call to supportedModels() below runs BEFORE
    // any prompt iteration starts, so the placeholder text is purely
    // transport-shape filler for cache_control safety.
    const PROBE_PROMPT = 'p';
    query = sdk.query({
      prompt: PROBE_PROMPT,
      options: { tools: [], maxTurns: 0 },
    });
    const knownById = new Map(CLAUDE_SUBSCRIPTION_MODELS.map((m) => [m.id, m]));
    // As of @anthropic-ai/claude-agent-sdk@0.3.233 (upgraded from 0.1.77),
    // each entry also carries `resolvedModel` — the real, backend-resolved
    // dated model id behind the alias (e.g. `value: 'default'` resolves to
    // `resolvedModel: 'claude-sonnet-5'`) — plus effort/thinking capability
    // flags. `resolvedModel` did not exist on 0.1.77; treat it as optional
    // so an older/downgraded SDK build still degrades to the pre-upgrade
    // alias-only behavior below rather than breaking.
    const supportedModels = (
      query as unknown as {
        supportedModels?: () => Promise<
          Array<{
            value: string;
            resolvedModel?: string;
            displayName?: string;
            description?: string;
            supportsEffort?: boolean;
            supportsAdaptiveThinking?: boolean;
          }>
        >;
      }
    ).supportedModels;
    if (typeof supportedModels !== 'function') {
      return {
        models: CLAUDE_SUBSCRIPTION_MODELS,
        source: 'OFFICIAL_STATIC_METADATA',
      };
    }

    const discovered = await supportedModels.call(query);
    // Observed live behavior (not documented): an unauthenticated/no-session
    // probe resolves `supportedModels()` successfully but with a single
    // placeholder entry (`value: 'default'`) instead of throwing or
    // returning []. That is not real account data — trusting it would
    // silently report a fake "default" model. Every real Claude model id
    // either starts with `claude-` (dated ids) or is one of the CLI's own
    // documented generic aliases (its interactive model picker's alias
    // table: sonnet/opus/haiku/sonnet[1m]/opusplan) — require at least one
    // discovered entry to look like a real id before trusting the batch.
    const KNOWN_GENERIC_ALIASES = new Set([
      'sonnet',
      'opus',
      'haiku',
      'sonnet[1m]',
      'opusplan',
    ]);
    const looksLikeRealModelId = (id: string) =>
      id.startsWith('claude-') || KNOWN_GENERIC_ALIASES.has(id);
    // A live `resolvedModel` is stronger evidence than the alias heuristic
    // above -- it's the backend's own resolved dated id, not a guess from
    // the alias string -- so it alone can satisfy the trust check (this is
    // what makes a *solitary* `default` entry trustworthy on 0.3.233, where
    // it previously wasn't on 0.1.77: the old shape had no `resolvedModel`
    // to corroborate it, only the ambiguous label).
    const hasTrustedResolvedModel = (info: { resolvedModel?: string }) =>
      typeof info.resolvedModel === 'string' &&
      info.resolvedModel.startsWith('claude-');
    if (
      !discovered ||
      discovered.length === 0 ||
      !discovered.some(
        (info) =>
          looksLikeRealModelId(info.value) || hasTrustedResolvedModel(info),
      )
    ) {
      return {
        models: CLAUDE_SUBSCRIPTION_MODELS,
        source: 'OFFICIAL_STATIC_METADATA',
      };
    }

    // The batch has already been trust-checked above, so a lone-`default`
    // probe artifact with no corroborating `resolvedModel` and no other
    // real entries was already rejected and never reaches this point. Once
    // a batch is trusted, the live CLI's own "default" alias (its
    // recommended/current model) is real, account-scoped data too and must
    // not be silently dropped from the final list.
    const isKeepableDiscoveredId = (info: {
      value: string;
      resolvedModel?: string;
    }) =>
      looksLikeRealModelId(info.value) ||
      info.value === 'default' ||
      hasTrustedResolvedModel(info);

    // Multiple aliases can resolve to the same real model (observed live:
    // both `default` and `sonnet` resolve to `claude-sonnet-5`) -- dedupe
    // by the canonical id so the account's real per-model count is
    // reported once each, not once per alias. Prefer a non-`default` alias
    // entry as the display-name source when both exist for the same
    // canonical id, since `default` is a generic "current recommendation"
    // label ("Default (recommended)") rather than the model's own name.
    const byCanonicalId = new Map<
      string,
      { info: (typeof discovered)[number]; isDefaultAlias: boolean }
    >();
    for (const info of discovered) {
      if (!isKeepableDiscoveredId(info)) continue;
      const canonicalId = hasTrustedResolvedModel(info)
        ? (info.resolvedModel as string)
        : info.value;
      const isDefaultAlias = info.value === 'default';
      const existing = byCanonicalId.get(canonicalId);
      if (!existing || (existing.isDefaultAlias && !isDefaultAlias)) {
        byCanonicalId.set(canonicalId, { info, isDefaultAlias });
      }
    }

    const models: ClaudeSubscriptionModelMetadata[] = Array.from(
      byCanonicalId.entries(),
    ).map(([canonicalId, { info }]) => {
      const known = knownById.get(canonicalId);
      if (known) {
        return { ...known, source: 'ACCOUNT_DYNAMIC' };
      }
      return {
        id: canonicalId,
        name: info.displayName ?? canonicalId,
        // Not a per-model pinned reference — no table entry matched this
        // live-discovered id. These are the generic Claude-4.x-generation
        // floor values, kept here ONLY as a transport-side outbound
        // safety budget. limitsSource: 'GENERIC_FLOOR' tells downstream
        // consumers (universal inventory) to report UNKNOWN rather than
        // this number as the model's true contextWindow/maxOutputTokens.
        contextWindow: CLAUDE_GENERATION_CONTEXT_WINDOW,
        maxTokens: CLAUDE_UNKNOWN_MODEL_MAX_TOKENS_FLOOR,
        // Prefer the SDK's own explicit capability flags (0.3.233+) over
        // the old description-text regex sniff, which 0.3.233's real
        // descriptions (e.g. "Sonnet 5 · Efficient for routine tasks")
        // no longer contain the words "reasoning"/"thinking" for anyway.
        // Still fall back to the regex for an older SDK shape that has
        // neither flag.
        reasoning:
          info.supportsAdaptiveThinking === true ||
          info.supportsEffort === true ||
          /reasoning|thinking/i.test(info.description ?? ''),
        source: 'ACCOUNT_DYNAMIC',
        limitsSource: 'GENERIC_FLOOR',
      };
    });
    return { models, source: 'ACCOUNT_DYNAMIC' };
  } catch {
    return {
      models: CLAUDE_SUBSCRIPTION_MODELS,
      source: 'OFFICIAL_STATIC_METADATA',
    };
  } finally {
    query?.close?.();
  }
}

// ─── Streaming transport ────────────────────────────────────────────────

/**
 * Render the user-visible transcript PLUMB's chat passes to the Agent SDK
 * as a single prompt string.
 *
 * CRITICAL INVARIANT — ANTHROPIC cache_control SAFETY:
 *
 * Anthropic's API rejects every request that attaches `cache_control` to a
 * zero-length text content block (HTTP 400 `cache_control cannot be set
 * for empty text blocks`). The Agent SDK auto-attaches a
 * `cache_control: { type: "ephemeral" }` breakpoint to the LAST text
 * content block it ships, so the literal prompt string we hand to the
 * SDK becomes the user-message text and inherits that breakpoint. A
 * zero-length prompt — or one whose content is purely whitespace the
 * SDK's own normalize pass collapses to empty — becomes an empty text
 * block carrying cache_control and the request is rejected.
 *
 * This function MUST therefore guarantee a non-empty, non-whitespace-only
 * prompt back to every caller. The chat path is normally safe (the user
 * always typed at least one character into the input box), but defensive
 * callers — disabled subsystems, broken message conversion, etc. —
 * MUST NOT be allowed to silently regress this invariant. We refuse to
 * return `''`; in the impossible "no system prompt and no messages" case
 * we surface a single zero-width placeholder char that survives the
 * SDK's normalize pass and is meaningless to the model.
 */
export function formatTranscriptPrompt(options: PlumbStreamOptions): string {
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
  const prompt = lines.join('\n\n');
  // Defense in depth: if the resulting prompt is empty or whitespace-only
  // (e.g. a caller passed no systemPrompt and an empty messages array),
  // return a single Unicode LINE SEPARATOR (U+2028) — a non-empty,
  // non-whitespace code point that is semantically zero-width to the
  // model. The SDK ships a real text block (cache_control-valid) and the
  // model sees no input — safer than throwing, which would break the
  // stream pipeline and produce a worse UX than a single empty turn.
  if (prompt.length === 0 || /^\s*$/.test(prompt)) {
    // Same invariant as getClaudeSubscriptionModels's probe placeholder
    // — a single non-whitespace ASCII char that survives any
    // SDK-side normalize pass. The text never reaches the model in
    // the first place (a real chat turn is the only path that calls
    // this, and a real chat turn always has a non-empty user
    // message); this branch is purely defense in depth.
    return '.';
  }
  return prompt;
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

  // CRITICAL INVARIANT — ANTHROPIC cache_control SAFETY (defense in depth):
  //
  // formatTranscriptPrompt() already guarantees a non-empty prompt, but
  // a future regression there must NOT be allowed to silently ship a
  // zero-length prompt to the SDK (Anthropic then rejects the request
  // with HTTP 400: `cache_control cannot be set for empty text blocks`).
  // Re-verify the invariant here at the exact Anthropic-boundary
  // transition; this is the single point of egress to the Agent SDK in
  // the whole chat pipeline, so guarding it here covers every caller.
  if (prompt.length === 0 || /^\s*$/.test(prompt)) {
    yield {
      type: 'error',
      error: {
        code: 'INVALID_PROMPT',
        message:
          'PLUMB refused to send a zero-length prompt to the Claude subscription transport. ' +
          'This is an internal invariant violation; please file a bug with the prompt that produced it.',
      },
    };
    return;
  }

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
          ? {
              mcpServers: { plumb: mcpServer },
              maxTurns: 10,
              // The SDK's own permission gate (`permissionMode: 'default'`)
              // prompts before executing ANY tool call, including in-process
              // MCP calls registered via createSdkMcpServer — and nothing in
              // this non-interactive transport ever answers that prompt, so
              // the query hangs forever after the model's first tool_use
              // (observed as: assistant emits intro text, then the session
              // silently stalls with no tool execution, no continuation, no
              // final answer). PLUMB's own CoreToolScheduler, reached inside
              // the `plumb` MCP tool handlers built by buildPlumbMcpServer
              // above (see toSdkCallToolResult / the module doc's
              // CLAUDE_SUBSCRIPTION_TOOL_AUTHORITY note), is already the real
              // permission/confirmation authority for every one of these
              // calls — so the SDK's redundant gate must be bypassed here,
              // not left unanswered.
              permissionMode: 'bypassPermissions' as const,
              allowDangerouslySkipPermissions: true,
            }
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
          // Pinned SDK 0.1.77 shape: SDKAssistantMessage.message.content
          // (nested APIAssistantMessage). The top-level `content` read is a
          // legacy-shape fallback only — see the SdkMessage doc above.
          const contentBlocks =
            message.message?.content ?? message.content ?? [];
          for (const block of contentBlocks) {
            if (block.type === 'text' && block.text) {
              yield { type: 'text', text: block.text };
            } else if (block.type === 'thinking' && block.thinking) {
              yield { type: 'thinking', thinkingText: block.thinking };
            }
            // tool_use blocks are intentionally not surfaced as PLUMB stream
            // events here. This is NOT dead code when `mcpServer` is wired:
            // PLUMB tool calls execute through the SDK's own MCP dispatch
            // (the `tool()` handlers registered in buildPlumbMcpServer),
            // which is a separate channel from this content-block loop — the
            // SDK invokes those handlers directly and folds their results
            // back into its own turn, so this loop never needs to react to
            // tool_use blocks to make execution happen. When `mcpServer` is
            // absent (no PLUMB tools registered this turn), `tools: []` means
            // a tool_use block should never appear at all; if the SDK ever
            // emits one anyway, silently dropping it is the safe failure
            // mode.
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

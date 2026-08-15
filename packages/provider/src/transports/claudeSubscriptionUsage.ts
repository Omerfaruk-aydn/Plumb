/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ─── Claude subscription usage/rate-limit reporting ──────────────────────
//
// The official Claude Code CLI (bundled with the Agent SDK) tracks the
// account's 5-hour/weekly rate-limit windows by calling Anthropic's
// `GET /api/oauth/usage` endpoint with the same OAuth bearer token it uses
// for chat — the request/response shape is confirmed directly from the
// bundled cli.js (`anthropic-ratelimit-unified-{5h,7d,7d_oi}-*` headers,
// `five_hour`/`seven_day`/`seven_day_opus`/`seven_day_sonnet`/`limits[]`
// response fields).
//
// The Agent SDK's programmatic `query()` surface (transports/
// claudeSubscription.ts, PLUMB's real chat integration) does not expose
// this data — it is internal to the interactive CLI's own status-bar
// rendering, not part of the SDK's documented type contract. To surface it
// in PLUMB, this module reads the OAuth access token the official CLI
// itself already persisted to `~/.claude/.credentials.json` after
// `claude setup-token`/`claude auth login`, and makes the same read-only,
// informational GET call the CLI's own UI makes. This is a deliberate,
// user-approved exception to "only talk to Claude through the documented
// Agent SDK boundary" — narrowly scoped to a read-only usage lookup, never
// used to originate chat requests, and it never writes to or moves that
// credential file.

const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface ClaudeAiOAuthCredential {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}

interface ClaudeCredentialsFile {
  claudeAiOauth?: ClaudeAiOAuthCredential;
}

export interface ClaudeUsageWindow {
  /** 0-100. */
  usedPercent: number;
  /** Absolute reset time in epoch ms, when reported. */
  resetsAt?: number;
}

export interface ClaudeScopedWeeklyUsage extends ClaudeUsageWindow {
  /** Model-family label as reported by the API (e.g. "Fable", "Opus"). */
  label: string;
}

export interface ClaudeSubscriptionUsageSummary {
  fetchedAt: number;
  subscriptionType?: string;
  /** Account-wide rolling 5-hour session window. */
  fiveHour?: ClaudeUsageWindow;
  /** Account-wide rolling 7-day (weekly) window. */
  weekly?: ClaudeUsageWindow;
  /** Legacy per-model weekly buckets — null/absent on most accounts now
   * that Anthropic moved model-scoped weekly caps to `limits[]`. */
  weeklyOpus?: ClaudeUsageWindow;
  weeklySonnet?: ClaudeUsageWindow;
  /** Model-family-scoped weekly rows from `limits[]` (e.g. Fable). */
  scopedWeekly: ClaudeScopedWeeklyUsage[];
}

export type ClaudeUsageUnavailableReason =
  | 'NO_CREDENTIALS_FILE'
  | 'TOKEN_EXPIRED'
  | 'REQUEST_FAILED'
  | 'NO_USAGE_DATA';

export type ClaudeUsageResult =
  | { ok: true; usage: ClaudeSubscriptionUsageSummary }
  | { ok: false; reason: ClaudeUsageUnavailableReason; detail?: string };

function credentialsFilePath(): string {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

function readAccessToken():
  | { accessToken: string; subscriptionType?: string }
  | { error: ClaudeUsageUnavailableReason; detail?: string } {
  let raw: string;
  try {
    raw = fs.readFileSync(credentialsFilePath(), 'utf8');
  } catch {
    return { error: 'NO_CREDENTIALS_FILE' };
  }
  let parsed: ClaudeCredentialsFile;
  try {
    parsed = JSON.parse(raw) as ClaudeCredentialsFile;
  } catch {
    return { error: 'NO_CREDENTIALS_FILE', detail: 'malformed JSON' };
  }
  const oauth = parsed.claudeAiOauth;
  if (!oauth?.accessToken) {
    return {
      error: 'NO_CREDENTIALS_FILE',
      detail: 'no claudeAiOauth.accessToken',
    };
  }
  if (oauth.expiresAt !== undefined && oauth.expiresAt <= Date.now()) {
    return { error: 'TOKEN_EXPIRED' };
  }
  return {
    accessToken: oauth.accessToken,
    subscriptionType: oauth.subscriptionType,
  };
}

interface ClaudeUsageBucket {
  utilization?: number;
  resets_at?: string;
}

interface ClaudeApiLimitEntry {
  kind?: string;
  percent?: number;
  resets_at?: string | null;
  scope?: { model?: { display_name?: string | null } | null } | null;
}

interface ClaudeUsageResponse {
  five_hour?: ClaudeUsageBucket | null;
  seven_day?: ClaudeUsageBucket | null;
  seven_day_opus?: ClaudeUsageBucket | null;
  seven_day_sonnet?: ClaudeUsageBucket | null;
  limits?: ClaudeApiLimitEntry[];
}

function parseIsoTime(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBucket(
  bucket: ClaudeUsageBucket | null | undefined,
): ClaudeUsageWindow | undefined {
  if (!bucket || bucket.utilization === undefined) return undefined;
  const resetsAt = parseIsoTime(bucket.resets_at);
  return {
    usedPercent: Math.min(Math.max(bucket.utilization, 0), 100),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

function parseScopedWeekly(
  entries: ClaudeApiLimitEntry[] | undefined,
): ClaudeScopedWeeklyUsage[] {
  if (!Array.isArray(entries)) return [];
  const out: ClaudeScopedWeeklyUsage[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== 'weekly_scoped') continue;
    const label = entry.scope?.model?.display_name?.trim();
    if (!label || seen.has(label) || entry.percent === undefined) continue;
    seen.add(label);
    const resetsAt = parseIsoTime(entry.resets_at);
    out.push({
      label,
      usedPercent: Math.min(Math.max(entry.percent, 0), 100),
      ...(resetsAt !== undefined ? { resetsAt } : {}),
    });
  }
  return out;
}

/**
 * Fetches the authenticated Claude subscription's current 5-hour/weekly
 * rate-limit usage. Read-only; never refreshes or rewrites the credential
 * file (an expired token is reported as TOKEN_EXPIRED, not refreshed here —
 * that's the official CLI's job via `claude setup-token`).
 */
export async function fetchClaudeSubscriptionUsage(
  signal?: AbortSignal,
): Promise<ClaudeUsageResult> {
  const token = readAccessToken();
  if ('error' in token) {
    return { ok: false, reason: token.error, detail: token.detail };
  }

  let response: Response;
  try {
    response = await fetch(USAGE_ENDPOINT, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token.accessToken}`,
      },
      signal,
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'REQUEST_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: 'REQUEST_FAILED',
      detail: `HTTP ${response.status}`,
    };
  }

  let payload: ClaudeUsageResponse;
  try {
    payload = (await response.json()) as ClaudeUsageResponse;
  } catch (err) {
    return {
      ok: false,
      reason: 'REQUEST_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const fiveHour = parseBucket(payload.five_hour);
  const weekly = parseBucket(payload.seven_day);
  const weeklyOpus = parseBucket(payload.seven_day_opus);
  const weeklySonnet = parseBucket(payload.seven_day_sonnet);
  const scopedWeekly = parseScopedWeekly(payload.limits);

  if (
    !fiveHour &&
    !weekly &&
    !weeklyOpus &&
    !weeklySonnet &&
    scopedWeekly.length === 0
  ) {
    return { ok: false, reason: 'NO_USAGE_DATA' };
  }

  return {
    ok: true,
    usage: {
      fetchedAt: Date.now(),
      subscriptionType: token.subscriptionType,
      ...(fiveHour ? { fiveHour } : {}),
      ...(weekly ? { weekly } : {}),
      ...(weeklyOpus ? { weeklyOpus } : {}),
      ...(weeklySonnet ? { weeklySonnet } : {}),
      scopedWeekly,
    },
  };
}

export const CLAUDE_SUBSCRIPTION_USAGE_WINDOW_MS = {
  fiveHour: FIVE_HOURS_MS,
  weekly: SEVEN_DAYS_MS,
} as const;

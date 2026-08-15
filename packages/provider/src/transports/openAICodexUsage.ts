/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlumbOAuthCredential } from '../types.js';

// ─── ChatGPT Plus/Pro (OpenAI Codex) usage/rate-limit reporting ──────────
//
// Unlike Claude Subscription, PLUMB owns this OAuth credential directly
// (stored via the normal provider-registry auth flow — see
// registry/provider-registry.ts#setAuthenticated), so this is a plain,
// fully-sanctioned use of an already-PLUMB-held token. No external
// credential file reads involved.

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api';
const CODEX_USAGE_PATH = 'wham/usage';

interface CodexUsageWindowPayload {
  used_percent?: number;
  reset_after_seconds?: number;
}

interface CodexUsageRateLimitPayload {
  primary_window?: CodexUsageWindowPayload | null;
  secondary_window?: CodexUsageWindowPayload | null;
}

interface CodexUsagePayload {
  plan_type?: string;
  rate_limit?: CodexUsageRateLimitPayload | null;
}

export interface CodexUsageWindow {
  usedPercent: number;
  /** Absolute reset time in epoch ms, derived from the response's
   * relative `reset_after_seconds` at fetch time. */
  resetsAt?: number;
}

export interface OpenAICodexUsageSummary {
  fetchedAt: number;
  planType?: string;
  /** Short rolling window (mirrors Claude's 5-hour session window). */
  primary?: CodexUsageWindow;
  /** Longer rolling window (mirrors Claude's weekly window). */
  secondary?: CodexUsageWindow;
}

export type CodexUsageUnavailableReason =
  | 'NOT_AUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'REQUEST_FAILED'
  | 'NO_USAGE_DATA';

export type CodexUsageResult =
  | { ok: true; usage: OpenAICodexUsageSummary }
  | { ok: false; reason: CodexUsageUnavailableReason; detail?: string };

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  return Buffer.from(base64 + '='.repeat(padLen), 'base64').toString('utf8');
}

function extractAccountIdFromJwt(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as {
      'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
    };
    return payload['https://api.openai.com/auth']?.chatgpt_account_id;
  } catch {
    return undefined;
  }
}

function parseWindow(
  payload: CodexUsageWindowPayload | null | undefined,
  now: number,
): CodexUsageWindow | undefined {
  if (!payload || payload.used_percent === undefined) return undefined;
  const resetsAt =
    payload.reset_after_seconds !== undefined
      ? now + payload.reset_after_seconds * 1000
      : undefined;
  return {
    usedPercent: Math.min(Math.max(payload.used_percent, 0), 100),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

/**
 * Fetches the authenticated ChatGPT Plus/Pro (OpenAI Codex) account's
 * current usage windows. `credential` is whatever is already stored for
 * the `openai-codex` provider (see PlumbProviderRegistry#getProviderState).
 */
export async function fetchOpenAICodexUsage(
  credential: PlumbOAuthCredential,
  signal?: AbortSignal,
): Promise<CodexUsageResult> {
  if (credential.expires <= Date.now()) {
    return { ok: false, reason: 'TOKEN_EXPIRED' };
  }
  const accountId =
    credential.accountId ?? extractAccountIdFromJwt(credential.access);

  let response: Response;
  try {
    response = await fetch(`${CODEX_BASE_URL}/${CODEX_USAGE_PATH}`, {
      headers: {
        Authorization: `Bearer ${credential.access}`,
        'User-Agent': 'PLUMB-CLI',
        ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
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

  let payload: CodexUsagePayload;
  try {
    payload = (await response.json()) as CodexUsagePayload;
  } catch (err) {
    return {
      ok: false,
      reason: 'REQUEST_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const now = Date.now();
  const primary = parseWindow(payload.rate_limit?.primary_window, now);
  const secondary = parseWindow(payload.rate_limit?.secondary_window, now);
  if (!primary && !secondary) {
    return { ok: false, reason: 'NO_USAGE_DATA' };
  }

  return {
    ok: true,
    usage: {
      fetchedAt: now,
      planType: payload.plan_type,
      ...(primary ? { primary } : {}),
      ...(secondary ? { secondary } : {}),
    },
  };
}

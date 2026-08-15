/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  PlumbOAuthCredential,
  PlumbApiKeyCredential,
  PlumbProviderId,
} from '../types.js';
import type {
  UsageCredential,
  UsageProvider,
  UsageReport,
} from '../vendor-ai/usage.js';
import { cursorUsageProvider } from '../vendor-ai/usage/cursor.js';
import { githubCopilotUsageProvider } from '../vendor-ai/usage/github-copilot.js';
import { kimiUsageProvider } from '../vendor-ai/usage/kimi.js';
import { xaiOauthUsageProvider } from '../vendor-ai/usage/xai-oauth.js';
import { umansUsageProvider } from '../vendor-ai/usage/umans.js';
import { opencodeGoUsageProvider } from '../vendor-ai/usage/opencode-go.js';
import { alibabaTokenPlanUsageProvider } from '../vendor-ai/usage/alibaba-token-plan.js';
import { minimaxCodeUsageProvider } from '../vendor-ai/usage/minimax-code.js';
import { zaiUsageProvider } from '../vendor-ai/usage/zai.js';
import { antigravityUsageProvider } from '../vendor-ai/usage/plumbGoogleAntigravity.js';
import { googleGeminiCliUsageProvider } from '../vendor-ai/usage/plumbGemini.js';

// ─── Generic vendored (OMP) usage reporting ───────────────────────────────
//
// These providers' usage/rate-limit fetchers were imported wholesale from
// upstream OMP (packages/provider/src/vendor-ai/usage/*.ts) and, unlike
// Claude Subscription, need no special-cased credential handling: PLUMB
// already stores a real OAuth or API-key credential for every provider
// below via the normal login flow (registry/provider-registry.ts
// #setAuthenticated), so this is a plain, fully-sanctioned reuse of a
// PLUMB-held token — never an external credential-file read.
//
// Each vendored `UsageProvider.id` is the *vendor's own* provider string,
// which for two of these differs from the PLUMB presentation id that owns
// the credential (`antigravity` -> `google-antigravity`, mirroring
// catalog/providers.ts's PLUMB_TO_OMP_ID login alias; `zai-coding-plan` ->
// `zai`, which has NO login-alias counterpart — the usage module was only
// ever given the direct-API-key provider's id upstream). This map is
// deliberately local to usage-reporting and must not be confused with (or
// merged into) PLUMB_TO_OMP_ID, which drives login/model-catalog
// resolution and has different correctness requirements (see
// catalog/model-catalog.ts's CATALOG_PROVIDER_FALLBACK for the same
// caution about conflating these).
const VENDOR_USAGE_PROVIDERS: Readonly<
  Partial<
    Record<PlumbProviderId, { vendorId: string; provider: UsageProvider }>
  >
> = {
  'github-copilot': {
    vendorId: 'github-copilot',
    provider: githubCopilotUsageProvider,
  },
  cursor: { vendorId: 'cursor', provider: cursorUsageProvider },
  'kimi-code': { vendorId: 'kimi-code', provider: kimiUsageProvider },
  'xai-oauth': { vendorId: 'xai-oauth', provider: xaiOauthUsageProvider },
  umans: { vendorId: 'umans', provider: umansUsageProvider },
  'opencode-go': { vendorId: 'opencode-go', provider: opencodeGoUsageProvider },
  'alibaba-token-plan': {
    vendorId: 'alibaba-token-plan',
    provider: alibabaTokenPlanUsageProvider,
  },
  'minimax-code': {
    vendorId: 'minimax-code',
    provider: minimaxCodeUsageProvider,
  },
  'zai-coding-plan': { vendorId: 'zai', provider: zaiUsageProvider },
  antigravity: {
    vendorId: 'google-antigravity',
    provider: antigravityUsageProvider,
  },
  'google-gemini-cli': {
    vendorId: 'google-gemini-cli',
    provider: googleGeminiCliUsageProvider,
  },
};

/** PLUMB provider ids with a wired-up generic vendor usage reporter. */
export const GENERIC_VENDOR_USAGE_PROVIDER_IDS: readonly PlumbProviderId[] =
  Object.keys(VENDOR_USAGE_PROVIDERS) as PlumbProviderId[];

function toUsageCredential(
  credential: PlumbOAuthCredential | PlumbApiKeyCredential,
): UsageCredential {
  if (credential.type === 'oauth') {
    return {
      type: 'oauth',
      accessToken: credential.access,
      refreshToken: credential.refresh,
      expiresAt: credential.expires,
      accountId: credential.accountId,
      email: credential.email,
      orgId: credential.orgId,
      orgName: credential.orgName,
    };
  }
  return { type: 'api_key', apiKey: credential.key };
}

export type GenericVendorUsageUnavailableReason =
  | 'NOT_SUPPORTED'
  | 'NOT_AUTHENTICATED'
  | 'REQUEST_FAILED';

export type GenericVendorUsageResult =
  | { ok: true; report: UsageReport }
  | { ok: false; reason: GenericVendorUsageUnavailableReason };

/**
 * Fetches usage for any PLUMB provider id in {@link GENERIC_VENDOR_USAGE_PROVIDER_IDS},
 * using whatever credential PLUMB already has stored for it.
 */
export async function fetchGenericVendorUsage(
  plumbProviderId: PlumbProviderId,
  credential: PlumbOAuthCredential | PlumbApiKeyCredential,
  signal?: AbortSignal,
): Promise<GenericVendorUsageResult> {
  const entry = VENDOR_USAGE_PROVIDERS[plumbProviderId];
  if (!entry) return { ok: false, reason: 'NOT_SUPPORTED' };

  const usageCredential = toUsageCredential(credential);
  const params = {
    provider: entry.vendorId,
    credential: usageCredential,
    accountKey: credential.type === 'oauth' ? credential.accountId : undefined,
    signal,
  };

  if (entry.provider.supports && !entry.provider.supports(params)) {
    return { ok: false, reason: 'NOT_AUTHENTICATED' };
  }

  try {
    const report = await entry.provider.fetchUsage(params, { fetch });
    if (!report) return { ok: false, reason: 'REQUEST_FAILED' };
    return { ok: true, report };
  } catch {
    return { ok: false, reason: 'REQUEST_FAILED' };
  }
}

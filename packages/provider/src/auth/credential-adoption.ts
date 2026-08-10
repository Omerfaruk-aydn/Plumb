/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical adoption of an already-completed OMP login result into the
 * single PLUMB credential authority: the factory-registered secure
 * credential store plus the PlumbProviderRegistry.
 *
 * This module performs NO login of its own and never starts an OAuth flow.
 * It exists because there are exactly two callers that drive the OMP
 * registry `login` function to completion:
 *
 *   1. `/login <provider>` — PlumbProviderAuthService.#ompLoginFlow
 *      (packages/core), which persists the result immediately; and
 *   2. `plumb --test-provider <coding-plan>` — the live acceptance harness
 *      (packages/cli), which drives the same OMP login interactively.
 *
 * Caller 2 previously kept the credential in runtime memory only, so
 * store-resolving production transports (the google-gemini-cli /
 * google-antigravity dialect: buildAntigravityRequest ->
 * resolveUsablePlumbCredential) could not see the credential the user had
 * just authenticated with — the immediate production stream failed with
 * NO_CREDENTIAL right after "Authentication successful." (live-observed
 * against a real Antigravity account). Routing both callers through this
 * one function keeps a single canonical credential write path: same store,
 * same PLUMB presentation-id scope (never the OMP catalog id), same
 * registry notification — no duplicate scopes, no parallel stores.
 */

import { ensurePlumbCredentialStore } from './credential-store.js';
import { getPlumbProviderRegistry } from '../registry/provider-registry.js';
import type {
  PlumbApiKeyCredential,
  PlumbOAuthCredential,
  PlumbProviderId,
} from '../types.js';
import type { OAuthCredentials } from '../omp-ai/registry/oauth/types.js';

export type AdoptedPlumbLoginCredential =
  | { kind: 'oauth'; credential: PlumbOAuthCredential }
  | { kind: 'api_key'; credential: PlumbApiKeyCredential }
  | { kind: 'none' };

/**
 * Map an OMP OAuthCredentials object onto the PLUMB credential shape.
 * Field-for-field identical to the mapping /login performs
 * (PlumbProviderAuthService.#toPlumbCredential) — keep them in lockstep.
 */
export function ompLoginCredentialToPlumb(
  providerId: PlumbProviderId,
  omp: OAuthCredentials,
): PlumbOAuthCredential {
  return {
    type: 'oauth',
    provider: providerId,
    access: omp.access,
    refresh: omp.refresh,
    expires: omp.expires,
    email: omp.email,
    accountId: omp.accountId,
    orgId: omp.orgId,
    orgName: omp.orgName,
    authorizedAt: omp.authorizedAt,
    projectId: omp.projectId,
    enterpriseUrl: omp.enterpriseUrl,
    apiEndpoint: omp.apiEndpoint,
  };
}

function isOauthLoginResult(value: unknown): value is OAuthCredentials {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { access?: unknown }).access === 'string' &&
    (value as { access: string }).access.length > 0
  );
}

/**
 * Adopt a completed OMP login result into the canonical PLUMB credential
 * authority under `providerId` (the PLUMB presentation id — credential
 * scope resolution via resolvePlumbProviderId keys on it, and
 * PlumbProviderRegistry state is keyed by it).
 *
 * Mirrors the post-login persistence leg of /login exactly:
 *   - string result            -> api_key credential (paste-key flows)
 *   - OAuthCredentials result  -> oauth credential (device/paste-code flows)
 *   - anything else            -> { kind: 'none' }, nothing is written
 *
 * Returns the adopted credential so callers can classify/report without
 * ever re-reading secret material. Never prints or logs the credential.
 */
export async function adoptPlumbLoginResult(
  providerId: PlumbProviderId,
  loginResult: unknown,
): Promise<AdoptedPlumbLoginCredential> {
  if (typeof loginResult === 'string' && loginResult.trim().length > 0) {
    const credential: PlumbApiKeyCredential = {
      type: 'api_key',
      provider: providerId,
      key: loginResult,
    };
    const store = await ensurePlumbCredentialStore();
    await store.storeApiKeyCredential(providerId, credential);
    await getPlumbProviderRegistry().setAuthenticated(providerId, credential);
    return { kind: 'api_key', credential };
  }

  if (isOauthLoginResult(loginResult)) {
    const credential = ompLoginCredentialToPlumb(providerId, loginResult);
    const store = await ensurePlumbCredentialStore();
    await store.storeOAuthCredential(providerId, credential);
    await getPlumbProviderRegistry().setAuthenticated(providerId, credential);
    return { kind: 'oauth', credential };
  }

  return { kind: 'none' };
}

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ensurePlumbCredentialStore } from './credential-store.js';
import { getPlumbProviderRegistry } from '../registry/provider-registry.js';
import type {
  PlumbApiKeyCredential,
  PlumbOAuthCredential,
  PlumbProviderId,
} from '../types.js';
import type { OAuthCredentials } from '../vendor-ai/registry/oauth/types.js';

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

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ensurePlumbCredentialStore } from './credential-store.js';
import type { PlumbOAuthCredential, PlumbProviderId } from '../types.js';

export type CredentialClassification =
  | 'NO_CREDENTIAL'
  | 'EXPIRED_REFRESHABLE'
  | 'EXPIRED_UNREFRESHABLE'
  | 'VALID_CREDENTIAL'
  | 'INVALID_STORED_SHAPE'
  | 'REFRESH_FAILED';

export interface PlumbRefreshResult {
  success: boolean;
  credential?: PlumbOAuthCredential;
  error?: string;
}

/**
 * Performs the real, pinned-OMP-backed refresh-token exchange for a
 * provider and persists the result. Registered by the production runtime
 * bootstrap (packages/core/src/config/plumbInit.ts) — never implemented
 * ad hoc by a diagnostic or transport.
 */
export type PlumbCredentialRefresher = (
  providerId: string,
) => Promise<PlumbRefreshResult>;

let registeredRefresher: PlumbCredentialRefresher | null = null;

export function registerPlumbCredentialRefresher(
  fn: PlumbCredentialRefresher,
): void {
  registeredRefresher = fn;
}

export function resetPlumbCredentialRefresher(): void {
  registeredRefresher = null;
  inFlightResolutions.clear();
}

/**
 * Clear only the single-flight in-flight-resolution cache, leaving the
 * registered refresher intact. Test-only: production code never has a
 * reason to want a stale in-flight entry cleared without also tearing down
 * the refresher registration.
 */
export function clearPlumbCredentialResolverInFlight(): void {
  inFlightResolutions.clear();
}

// Caches the WHOLE resolution outcome (refresh + postcondition re-read +
// registry reload), not just the raw refresher call — so concurrent
// callers share one final result instead of each performing their own
// independent post-refresh store re-read, which would otherwise race
// against the refresher's own multi-step persist sequence (it writes the
// new credential more than once internally) and could transiently observe
// an empty/pruned intermediate state.
const inFlightResolutions = new Map<string, Promise<UsableCredentialResult>>();

export interface UsableCredentialResult {
  classification: CredentialClassification;
  credential: PlumbOAuthCredential | null;
  refreshAttempted: boolean;
  refreshFailureReason?: string;
}

function classifyOauth(
  cred: PlumbOAuthCredential | undefined,
): CredentialClassification {
  if (!cred) return 'NO_CREDENTIAL';
  if (!cred.access) return 'INVALID_STORED_SHAPE';
  if (cred.expires > Date.now()) return 'VALID_CREDENTIAL';
  return cred.refresh ? 'EXPIRED_REFRESHABLE' : 'EXPIRED_UNREFRESHABLE';
}

/**
 * Read the best available OAuth credential directly from the real secure
 * store (bypassing PlumbProviderRegistry's in-memory cache, which may be
 * stale). Prefers a non-expired entry; falls back to the most recently
 * expiring one so a stale duplicate is never preferred over a fresher one
 * (defense in depth — the store itself also prunes duplicates on write).
 */
async function bestOauthFromStore(
  providerId: string,
): Promise<PlumbOAuthCredential | undefined> {
  const store = await ensurePlumbCredentialStore();
  const entries = await store.getCredentials(providerId);
  const oauth = entries
    .map((e) => e.credential)
    .filter((c): c is PlumbOAuthCredential => c.type === 'oauth');
  if (oauth.length === 0) return undefined;
  const valid = oauth.find((c) => c.expires > Date.now());
  if (valid) return valid;
  return oauth.reduce((latest, c) => (c.expires > latest.expires ? c : latest));
}

/**
 * Resolve a provider's usable OAuth credential, refreshing exactly once
 * (single-flight per provider) when it is expired but a refresh token is
 * available. Only classifies VALID_CREDENTIAL after re-reading the store
 * post-refresh and confirming the postcondition actually holds — a
 * refresh call "succeeding" does not by itself mean the resulting
 * credential is usable.
 */
export async function resolveUsablePlumbCredential(
  providerId: PlumbProviderId,
): Promise<UsableCredentialResult> {
  const current = await bestOauthFromStore(providerId);
  const classification = classifyOauth(current);

  if (classification === 'VALID_CREDENTIAL') {
    return {
      classification,
      credential: current ?? null,
      refreshAttempted: false,
    };
  }
  if (classification !== 'EXPIRED_REFRESHABLE') {
    return { classification, credential: null, refreshAttempted: false };
  }
  if (!registeredRefresher) {
    return {
      classification: 'EXPIRED_REFRESHABLE',
      credential: null,
      refreshAttempted: false,
      refreshFailureReason: 'no credential refresher registered',
    };
  }

  // The entire refresh + postcondition re-read is single-flighted, not just
  // the raw refresher call — the refresher itself persists in more than one
  // internal step (write, then registry reload, which persists again), so
  // an independent re-read by a losing concurrent caller could otherwise
  // observe a transient intermediate state mid-write.
  let resolution = inFlightResolutions.get(providerId);
  if (!resolution) {
    resolution = performRefreshAndReread(providerId);
    resolution.finally(() => inFlightResolutions.delete(providerId));
    inFlightResolutions.set(providerId, resolution);
  }
  return resolution;
}

async function performRefreshAndReread(
  providerId: string,
): Promise<UsableCredentialResult> {
  const result = await registeredRefresher!(providerId);

  if (!result.success || !result.credential) {
    return {
      classification: 'REFRESH_FAILED',
      credential: null,
      refreshAttempted: true,
      refreshFailureReason: result.error ?? 'refresh returned no credential',
    };
  }

  // Postcondition check: re-read the store rather than trusting the
  // refresher's return value alone. The registered production refresher
  // already reloads PlumbProviderRegistry internally as part of its own
  // persist sequence, so no separate reload is issued here.
  const reread = await bestOauthFromStore(providerId);
  const rereadClassification = classifyOauth(reread);
  if (rereadClassification !== 'VALID_CREDENTIAL' || !reread) {
    return {
      classification: 'REFRESH_FAILED',
      credential: null,
      refreshAttempted: true,
      refreshFailureReason: `post-refresh readback classified as ${rereadClassification}`,
    };
  }

  return {
    classification: 'VALID_CREDENTIAL',
    credential: reread,
    refreshAttempted: true,
  };
}

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';
import { initializePlumbProviders, getPlumbCredentialStore } from '../index.js';
import {
  resetPlumbProviderRegistry,
  resolveUsablePlumbCredential,
  getPlumbProviderRegistry,
  clearPlumbCredentialResolverInFlight,
} from '@plumb/provider';

// initializePlumbProviders() is a process-lifetime-idempotent bootstrap by
// design (see packages/core/src/config/plumbInit.ts) — it is called ONCE
// here, exactly like normal chat only ever calls it once per process.
// Individual tests reset only the DATA (store.clearAll() + the in-memory
// registry cache), not the bootstrap registration itself.
let isolatedHome: string;
let previousHome: string | undefined;
let originalFetch: typeof fetch;

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

describe('Antigravity OAuth credential refresh — real store/registry/service path', () => {
  beforeAll(async () => {
    isolatedHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'plumb-antigravity-refresh-'),
    );
    previousHome = process.env['PLUMB_CLI_HOME'];
    process.env['PLUMB_CLI_HOME'] = isolatedHome;
    await initializePlumbProviders();
  });

  afterAll(() => {
    if (previousHome === undefined) {
      delete process.env['PLUMB_CLI_HOME'];
    } else {
      process.env['PLUMB_CLI_HOME'] = previousHome;
    }
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  });

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    await getPlumbCredentialStore().clearAll();
    resetPlumbProviderRegistry();
    // resetPlumbProviderRegistry() replaces the singleton with a fresh,
    // uninitialized instance — re-initialize it (idempotent, cheap; reads
    // the now-empty store) so registry.setAuthenticated() during refresh
    // doesn't throw "Registry not initialized."
    await getPlumbProviderRegistry().initialize();
    // Defensive: the single-flight cache is a process-wide module
    // singleton (packages/provider/src/auth/credential-resolver.ts) that
    // can outlive this describe block if another test file's process
    // shares the same vitest fork worker — never start a test with a
    // leftover in-flight entry for 'antigravity' from elsewhere.
    clearPlumbCredentialResolverInFlight();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('refreshes an expired credential through the real pinned OMP callback, preserves projectId, persists under the correct scope with no duplication, and reloads the registry', async () => {
    await initializePlumbProviders();
    const store = getPlumbCredentialStore();

    const expiredCredential = {
      type: 'oauth' as const,
      provider: 'antigravity',
      access: 'ya29.stale-access-token',
      refresh: 'refresh-token-still-valid',
      expires: Date.now() - 60_000,
      projectId: 'real-gcp-project-id',
    };
    await store.storeOAuthCredential('antigravity', expiredCredential);

    let tokenRequestBody: URLSearchParams | undefined;
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (String(url) === TOKEN_URL) {
        tokenRequestBody = new URLSearchParams(String(init?.body));
        return new Response(
          JSON.stringify({
            access_token: 'ya29.freshly-refreshed-token',
            expires_in: 3600,
            refresh_token: 'refresh-token-still-valid',
          }),
          { status: 200 },
        );
      }
      return originalFetch(url, init);
    }) as typeof fetch;

    // Confirm the pre-refresh state directly from the store (the resolver
    // itself only ever returns the POST-refresh outcome, by design).
    const storedBefore = await store.getCredentials('antigravity');
    expect(storedBefore).toHaveLength(1);
    expect(storedBefore[0].credential).toMatchObject({
      access: 'ya29.stale-access-token',
    });

    const result = await resolveUsablePlumbCredential('antigravity');

    // Postcondition-based success, not just "the call didn't throw".
    expect(result.classification).toBe('VALID_CREDENTIAL');
    expect(result.refreshAttempted).toBe(true);
    expect(result.credential).not.toBeNull();
    expect(result.credential?.access).toBe('ya29.freshly-refreshed-token');
    expect(result.credential?.expires).toBeGreaterThan(Date.now());
    // Project metadata must survive the refresh — Antigravity requests
    // are invalid without it.
    expect(result.credential?.projectId).toBe('real-gcp-project-id');
    // refreshAntigravityToken sent the ORIGINAL refresh token + projectId,
    // per the pinned OMP contract.
    expect(tokenRequestBody?.get('refresh_token')).toBe(
      'refresh-token-still-valid',
    );
    expect(tokenRequestBody?.get('grant_type')).toBe('refresh_token');

    // Exactly one OAuth entry survives under the correct (PLUMB
    // presentation id) scope — no duplicate/orphaned expired entry left
    // behind, and nothing was ever written under the OMP catalog id.
    const survivingEntries = await store.getCredentials('antigravity');
    const oauthSurvivors = survivingEntries.filter(
      (e) => e.credential.type === 'oauth',
    );
    expect(oauthSurvivors).toHaveLength(1);
    expect(oauthSurvivors[0].credential).toMatchObject({
      access: 'ya29.freshly-refreshed-token',
    });
    const wrongScopeEntries = await store.getCredentials('google-antigravity');
    expect(wrongScopeEntries).toHaveLength(0);

    // The in-memory registry was reloaded, not just the disk/keychain
    // store — normal chat reads registry state, not the store directly.
    const registryState =
      getPlumbProviderRegistry().getProviderState('antigravity');
    expect(registryState?.authState).toBe('authenticated');
    expect(registryState?.credentials?.type).toBe('oauth');
    if (registryState?.credentials?.type === 'oauth') {
      expect(registryState.credentials.access).toBe(
        'ya29.freshly-refreshed-token',
      );
    }
  }, 20_000);

  it('classifies REFRESH_FAILED (not a crash, no thrown exception) when the token endpoint rejects the refresh token, and does not overwrite/destroy the existing stored credential racily', async () => {
    await initializePlumbProviders();
    const store = getPlumbCredentialStore();

    const expiredCredential = {
      type: 'oauth' as const,
      provider: 'antigravity',
      access: 'ya29.stale-access-token',
      refresh: 'refresh-token-now-invalid',
      expires: Date.now() - 60_000,
      projectId: 'real-gcp-project-id',
    };
    await store.storeOAuthCredential('antigravity', expiredCredential);

    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url) === TOKEN_URL) {
        return new Response('invalid_grant', { status: 400 });
      }
      return originalFetch(url);
    }) as typeof fetch;

    const result = await resolveUsablePlumbCredential('antigravity');

    expect(result.classification).toBe('REFRESH_FAILED');
    expect(result.credential).toBeNull();
    expect(result.refreshFailureReason).toBeTruthy();
  }, 20_000);

  it('de-duplicates concurrent refresh calls into a single token exchange (single-flight)', async () => {
    await initializePlumbProviders();
    const store = getPlumbCredentialStore();

    const expiredCredential = {
      type: 'oauth' as const,
      provider: 'antigravity',
      access: 'ya29.stale-access-token',
      refresh: 'refresh-token-still-valid',
      expires: Date.now() - 60_000,
      projectId: 'real-gcp-project-id',
    };
    await store.storeOAuthCredential('antigravity', expiredCredential);

    let tokenCallCount = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url) === TOKEN_URL) {
        tokenCallCount += 1;
        return new Response(
          JSON.stringify({
            access_token: `ya29.refreshed-${tokenCallCount}`,
            expires_in: 3600,
            refresh_token: 'refresh-token-still-valid',
          }),
          { status: 200 },
        );
      }
      return originalFetch(url);
    }) as typeof fetch;

    const [r1, r2, r3] = await Promise.all([
      resolveUsablePlumbCredential('antigravity'),
      resolveUsablePlumbCredential('antigravity'),
      resolveUsablePlumbCredential('antigravity'),
    ]);

    expect(tokenCallCount).toBe(1);
    for (const r of [r1, r2, r3]) {
      expect(r.classification).toBe('VALID_CREDENTIAL');
    }
  }, 20_000);
});

/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production-shaped regression for the live-observed Antigravity acceptance
 * failure: "Authentication successful." followed IMMEDIATELY by a production
 * stream reporting `No credential available for provider: antigravity
 * (NO_CREDENTIAL)`.
 *
 * Root cause chain this test pins: a completed OMP login result must be
 * ADOPTED into the canonical credential authority (factory-registered secure
 * store + PlumbProviderRegistry) under the PLUMB presentation id
 * (`antigravity`), and the production request builder
 * (buildAntigravityRequest -> resolvePlumbProviderId(model.provider) ->
 * resolveUsablePlumbCredential) must then resolve it — with no second
 * login, no duplicate scope, and no apiKey sidestep.
 *
 * Everything here is real except the credential store backend (in-memory;
 * no OS keychain in unit tests) and global fetch (never reached —
 * buildAntigravityRequest only constructs the descriptor).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerPlumbCredentialStoreFactory,
  resetPlumbCredentialStore,
  ensurePlumbCredentialStore,
  type IPlumbCredentialStore,
} from './credential-store.js';
import {
  resetPlumbCredentialRefresher,
  resolveUsablePlumbCredential,
} from './credential-resolver.js';
import {
  adoptPlumbLoginResult,
  ompLoginCredentialToPlumb,
} from './credential-adoption.js';
import {
  getPlumbProviderRegistry,
  resetPlumbProviderRegistry,
} from '../registry/provider-registry.js';
import { buildAntigravityRequest } from '../transports/streaming.js';
import type {
  PlumbCredential,
  PlumbCredentialEntry,
  PlumbModel,
} from '../types.js';
import type { OAuthCredentials } from '../omp-ai/registry/oauth/types.js';

// Keep model-cache/model-registry side effects (disk/home writes) out of
// this test — the registry's auth path stays real.
vi.mock('../registry/model-cache.js', () => ({
  invalidateModelCache: vi.fn(),
  readModelCache: vi.fn(),
  writeModelCache: vi.fn(),
  invalidateAllModelCache: vi.fn(),
}));
vi.mock('../registry/model-registry.js', () => ({
  getPlumbModelRegistry: () => ({ invalidateCache: vi.fn() }),
}));

/** In-memory IPlumbCredentialStore — prunes same-type duplicates on write,
 * mirroring the real store's behavior. */
function makeInMemoryStore(): IPlumbCredentialStore {
  const entries = new Map<string, PlumbCredentialEntry[]>();
  const put = (provider: string, credential: PlumbCredential) => {
    const list = (entries.get(provider) ?? []).filter(
      (e) => e.credential.type !== credential.type,
    );
    list.push({ provider, credential, source: 'oauth' });
    entries.set(provider, list);
  };
  const firstApiKey = (provider: string): string | undefined => {
    const entry = (entries.get(provider) ?? []).find(
      (e) => e.credential.type === 'api_key',
    );
    return entry?.credential.type === 'api_key'
      ? entry.credential.key
      : undefined;
  };
  return {
    getCredentials: async (provider) => entries.get(provider) ?? [],
    getApiKey: async (provider) => firstApiKey(provider),
    hasCredentials: async (provider) =>
      (entries.get(provider) ?? []).length > 0,
    listAuthenticatedProviders: async () => [...entries.keys()],
    storeCredential: async (provider, credential) => put(provider, credential),
    storeOAuthCredential: async (provider, credential) =>
      put(provider, credential),
    storeApiKeyCredential: async (provider, credential) =>
      put(provider, credential),
    removeCredentials: async (provider) => {
      entries.delete(provider);
    },
    removeCredential: async (provider, credentialType) => {
      const list = entries.get(provider) ?? [];
      const next = list.filter((e) => e.credential.type !== credentialType);
      const removed = next.length !== list.length;
      entries.set(provider, next);
      return removed;
    },
    clearAll: async () => entries.clear(),
    setProviderMetadata: async () => {},
    getProviderMetadata: async () => null,
    healthCheck: async () => ({ available: true, usingFallback: false }),
  };
}

/** Exact shape the real OMP google-antigravity login resolves with. */
function makeOmpAntigravityLoginResult(): OAuthCredentials {
  return {
    access: 'ya29.live-acceptance-access',
    refresh: 'live-acceptance-refresh',
    expires: Date.now() + 3_600_000,
    projectId: 'live-acceptance-gcp-project',
    email: 'user@example.com',
    accountId: 'acct-1',
    authorizedAt: Date.now(),
  };
}

const antigravityCatalogModel: PlumbModel = {
  id: 'gpt-oss-120b-medium',
  provider: 'google-antigravity',
  api: 'google-gemini-cli',
  contextWindow: 200000,
  maxTokens: 8192,
  reasoning: true,
  input: 'text',
};

describe('adoptPlumbLoginResult — canonical login adoption', () => {
  beforeEach(() => {
    resetPlumbCredentialRefresher();
    resetPlumbProviderRegistry();
    resetPlumbCredentialStore();
    registerPlumbCredentialStoreFactory(async () => makeInMemoryStore());
  });

  it('live auth success -> immediate real production stream credential resolution (antigravity)', async () => {
    const registry = getPlumbProviderRegistry();
    await registry.initialize();

    // Precondition: reproduces the broken live state — nothing stored, so
    // the production resolver reports exactly the live-observed failure.
    const before = await resolveUsablePlumbCredential('antigravity');
    expect(before.classification).toBe('NO_CREDENTIAL');

    // The single adoption leg (what the acceptance harness now performs
    // after the OMP login succeeds — same write path /login uses).
    const adopted = await adoptPlumbLoginResult(
      'antigravity',
      makeOmpAntigravityLoginResult(),
    );
    expect(adopted.kind).toBe('oauth');

    // Postcondition 1: the canonical resolver — the exact one
    // buildAntigravityRequest and the --test-antigravity-route diagnostics
    // share — now classifies the credential usable. No refresh needed.
    const after = await resolveUsablePlumbCredential('antigravity');
    expect(after.classification).toBe('VALID_CREDENTIAL');
    expect(after.refreshAttempted).toBe(false);
    expect(after.credential?.projectId).toBe('live-acceptance-gcp-project');

    // Postcondition 2: the REAL production request builder resolves the
    // adopted credential through the alias chain
    // (model.provider 'google-antigravity' -> scope 'antigravity') and
    // produces the real request descriptor.
    const request = await buildAntigravityRequest({
      model: antigravityCatalogModel,
      messages: [{ role: 'user', content: 'Say exactly: PLUMB_TEST_OK' }],
      apiKey: '',
    });
    expect(request.ok).toBe(true);
    if (request.ok) {
      expect(request.descriptor.headers['Authorization']).toBe(
        'Bearer ya29.live-acceptance-access',
      );
      const body = request.descriptor.body as { project?: string };
      expect(body.project).toBe('live-acceptance-gcp-project');
    }

    // Scope discipline: nothing was ever written under the OMP catalog id.
    const store = await ensurePlumbCredentialStore();
    expect(await store.getCredentials('google-antigravity')).toEqual([]);
    expect((await store.getCredentials('antigravity')).length).toBeGreaterThan(
      0,
    );

    // Registry state reflects the adoption (same as after /login).
    expect(registry.getProviderState('antigravity')?.authState).toBe(
      'authenticated',
    );
  });

  it('adopts a string login result as an api_key credential (paste-key flows)', async () => {
    const registry = getPlumbProviderRegistry();
    await registry.initialize();

    const adopted = await adoptPlumbLoginResult('nvidia', 'nvapi-test-key');
    expect(adopted.kind).toBe('api_key');

    const store = await ensurePlumbCredentialStore();
    expect(await store.getApiKey('nvidia')).toBe('nvapi-test-key');
    expect(registry.getProviderState('nvidia')?.authState).toBe(
      'authenticated',
    );
  });

  it('writes nothing and reports kind none for an unrecognized login result', async () => {
    const registry = getPlumbProviderRegistry();
    await registry.initialize();

    expect(await adoptPlumbLoginResult('antigravity', undefined)).toEqual({
      kind: 'none',
    });
    expect(await adoptPlumbLoginResult('antigravity', {})).toEqual({
      kind: 'none',
    });
    expect(await adoptPlumbLoginResult('antigravity', { access: '' })).toEqual(
      { kind: 'none' },
    );

    const store = await ensurePlumbCredentialStore();
    expect(await store.getCredentials('antigravity')).toEqual([]);
    expect(registry.getProviderState('antigravity')).toBeUndefined();
  });

  it('maps every OMP credential field /login maps (mapping lockstep)', () => {
    const omp: OAuthCredentials = {
      access: 'a',
      refresh: 'r',
      expires: 123,
      email: 'e@example.com',
      accountId: 'acc',
      orgId: 'org',
      orgName: 'Org',
      authorizedAt: 42,
      projectId: 'proj',
      enterpriseUrl: 'https://ghe.example.com',
      apiEndpoint: 'https://api.example.com',
    };
    const mapped = ompLoginCredentialToPlumb('antigravity', omp);
    expect(mapped).toEqual({
      type: 'oauth',
      provider: 'antigravity',
      access: 'a',
      refresh: 'r',
      expires: 123,
      email: 'e@example.com',
      accountId: 'acc',
      orgId: 'org',
      orgName: 'Org',
      authorizedAt: 42,
      projectId: 'proj',
      enterpriseUrl: 'https://ghe.example.com',
      apiEndpoint: 'https://api.example.com',
    });
  });
});


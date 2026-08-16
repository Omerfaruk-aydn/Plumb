/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { OAuthCredentials } from './types.js';

/**
 * In-memory stand-in for HybridTokenStorage, keyed by service name so the two
 * stores the wrapper builds stay independent the way real keychain entries do.
 */
const stores = new Map<string, Map<string, OAuthCredentials>>();
const failingServices = new Set<string>();

vi.mock('./hybrid-token-storage.js', () => ({
  HybridTokenStorage: class {
    constructor(private readonly serviceName: string) {
      if (!stores.has(serviceName)) stores.set(serviceName, new Map());
    }
    private entries() {
      if (failingServices.has(this.serviceName)) {
        throw new Error(`keychain unavailable for ${this.serviceName}`);
      }
      return stores.get(this.serviceName)!;
    }
    async getCredentials(server: string) {
      return this.entries().get(server) ?? null;
    }
    async setCredentials(c: OAuthCredentials) {
      this.entries().set(c.serverName, c);
    }
    async deleteCredentials(server: string) {
      this.entries().delete(server);
    }
    async listServers() {
      return [...this.entries().keys()];
    }
    async getAllCredentials() {
      return new Map(this.entries());
    }
    async clearAll() {
      this.entries().clear();
    }
  },
}));

const { MigratingTokenStorage } = await import('./migrating-token-storage.js');

const CURRENT = 'plumb-cli-oauth';
const LEGACY = 'gemini-cli-oauth';

function creds(serverName: string, token: string): OAuthCredentials {
  return {
    serverName,
    token: { accessToken: token } as OAuthCredentials['token'],
    updatedAt: 1,
  };
}

function seedLegacy(...entries: OAuthCredentials[]) {
  const store = stores.get(LEGACY) ?? new Map();
  for (const entry of entries) store.set(entry.serverName, entry);
  stores.set(LEGACY, store);
}

describe('MigratingTokenStorage', () => {
  beforeEach(() => {
    stores.clear();
    failingServices.clear();
    stores.set(CURRENT, new Map());
    stores.set(LEGACY, new Map());
  });

  it('finds credentials still filed under the old service name', async () => {
    seedLegacy(creds('main-account', 'old-token'));

    const storage = new MigratingTokenStorage(CURRENT, LEGACY);
    const found = await storage.getCredentials('main-account');

    expect(found?.token.accessToken).toBe('old-token');
  });

  it('copies them forward so the fallback is only needed once', async () => {
    seedLegacy(creds('main-account', 'old-token'));

    const storage = new MigratingTokenStorage(CURRENT, LEGACY);
    await storage.getCredentials('main-account');

    expect(stores.get(CURRENT)!.get('main-account')?.token.accessToken).toBe(
      'old-token',
    );
  });

  it('prefers a current entry over a stale legacy one', async () => {
    seedLegacy(creds('main-account', 'old-token'));
    const storage = new MigratingTokenStorage(CURRENT, LEGACY);
    await storage.setCredentials(creds('main-account', 'new-token'));

    const found = await storage.getCredentials('main-account');
    expect(found?.token.accessToken).toBe('new-token');
  });

  it('deletes from both stores so a logout cannot be undone by migration', async () => {
    seedLegacy(creds('main-account', 'old-token'));
    const storage = new MigratingTokenStorage(CURRENT, LEGACY);

    // Pull it forward first, mirroring a real session that used the login.
    await storage.getCredentials('main-account');
    await storage.deleteCredentials('main-account');

    expect(await storage.getCredentials('main-account')).toBeNull();
    expect(stores.get(LEGACY)!.has('main-account')).toBe(false);
  });

  it('clearAll empties the legacy store too', async () => {
    seedLegacy(creds('a', 't1'), creds('b', 't2'));
    const storage = new MigratingTokenStorage(CURRENT, LEGACY);

    await storage.clearAll();

    expect(await storage.listServers()).toEqual([]);
  });

  it('merges both stores when listing and reading everything', async () => {
    seedLegacy(creds('legacy-only', 'old'));
    const storage = new MigratingTokenStorage(CURRENT, LEGACY);
    await storage.setCredentials(creds('current-only', 'new'));

    expect((await storage.listServers()).sort()).toEqual([
      'current-only',
      'legacy-only',
    ]);
    expect((await storage.getAllCredentials()).size).toBe(2);
  });

  it('still works when the legacy store throws', async () => {
    failingServices.add(LEGACY);
    const storage = new MigratingTokenStorage(CURRENT, LEGACY);
    await storage.setCredentials(creds('main-account', 'new-token'));

    expect(
      (await storage.getCredentials('main-account'))?.token.accessToken,
    ).toBe('new-token');
    expect(await storage.listServers()).toEqual(['main-account']);
  });

  it('does not wrap a store around itself when the names match', async () => {
    const storage = new MigratingTokenStorage(CURRENT, CURRENT);
    await storage.setCredentials(creds('main-account', 'token'));
    await storage.deleteCredentials('main-account');

    expect(await storage.getCredentials('main-account')).toBeNull();
  });

  it('works with no legacy name at all', async () => {
    const storage = new MigratingTokenStorage(CURRENT);
    await storage.setCredentials(creds('main-account', 'token'));

    expect(
      (await storage.getCredentials('main-account'))?.token.accessToken,
    ).toBe('token');
  });
});

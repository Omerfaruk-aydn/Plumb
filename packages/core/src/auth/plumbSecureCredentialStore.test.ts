/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlumbSecureCredentialStore } from './plumbSecureCredentialStore.js';
import type {
  IPlumbCredentialStore,
  PlumbOAuthCredential,
  PlumbApiKeyCredential,
} from '@google/gemini-cli-provider';

describe('PlumbSecureCredentialStore', () => {
  let store: PlumbSecureCredentialStore;
  let isolatedHome: string;
  let previousHome: string | undefined;

  beforeEach(async () => {
    // Isolate GEMINI_CLI_HOME per test run so this suite's real-file writes
    // (~/.plumb/providers.json) never race other suites (e.g.
    // omp-keychain-adapter.test.ts) that touch the same real path.
    isolatedHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'plumb-secure-store-test-'),
    );
    previousHome = process.env['GEMINI_CLI_HOME'];
    process.env['GEMINI_CLI_HOME'] = isolatedHome;

    store = new PlumbSecureCredentialStore();
    await store.clearAll();
  });

  afterEach(async () => {
    await store.clearAll();
    if (previousHome === undefined) {
      delete process.env['GEMINI_CLI_HOME'];
    } else {
      process.env['GEMINI_CLI_HOME'] = previousHome;
    }
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  });

  it('satisfies the canonical IPlumbCredentialStore interface at compile time', () => {
    const asInterface: IPlumbCredentialStore = store;
    expect(asInterface).toBe(store);
  });

  it('exposes storeOAuthCredential as a callable function (the regressed method)', () => {
    expect(typeof store.storeOAuthCredential).toBe('function');
  });

  it('exposes storeApiKeyCredential as a callable function', () => {
    expect(typeof store.storeApiKeyCredential).toBe('function');
  });

  it('persists a GitHub Copilot OAuth credential via storeOAuthCredential, preserving Copilot-specific fields', async () => {
    const cred: PlumbOAuthCredential = {
      type: 'oauth',
      provider: 'github-copilot',
      access: 'gho_access_token',
      refresh: 'gho_refresh_token',
      expires: Date.now() + 3600_000,
      email: 'user@example.com',
      accountId: 'copilot-acc-1',
      enterpriseUrl: 'https://ghe.example.com',
      apiEndpoint: 'https://api.githubcopilot.com',
    };

    await expect(
      store.storeOAuthCredential('github-copilot', cred),
    ).resolves.not.toThrow();

    const entries = await store.getCredentials('github-copilot');
    expect(entries.length).toBe(1);
    const persisted = entries[0].credential as PlumbOAuthCredential;
    expect(persisted.access).toBe('gho_access_token');
    expect(persisted.refresh).toBe('gho_refresh_token');
    expect(persisted.enterpriseUrl).toBe('https://ghe.example.com');
    expect(persisted.apiEndpoint).toBe('https://api.githubcopilot.com');
  });

  it('persists an API-key credential via storeApiKeyCredential', async () => {
    const cred: PlumbApiKeyCredential = {
      type: 'api_key',
      provider: 'nvidia',
      key: 'nvapi-test-key',
      label: 'nvidia-default',
    };

    await store.storeApiKeyCredential('nvidia', cred);
    const key = await store.getApiKey('nvidia');
    expect(key).toBe('nvapi-test-key');
  });

  it('scopes removal to a single provider, leaving other providers untouched', async () => {
    await store.storeApiKeyCredential('nvidia', {
      type: 'api_key',
      provider: 'nvidia',
      key: 'nvapi-key',
    });
    await store.storeOAuthCredential('github-copilot', {
      type: 'oauth',
      provider: 'github-copilot',
      access: 'gho_access',
      refresh: 'gho_refresh',
      expires: Date.now() + 3600_000,
    });

    await store.removeCredentials('github-copilot');

    expect(await store.hasCredentials('github-copilot')).toBe(false);
    expect(await store.hasCredentials('nvidia')).toBe(true);
    expect(await store.getApiKey('nvidia')).toBe('nvapi-key');
  });
});

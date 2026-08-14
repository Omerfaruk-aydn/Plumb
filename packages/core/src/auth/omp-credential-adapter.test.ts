/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OmpAuthSchemaKeychainAdapter } from './omp-credential-adapter.js';
import type {
  PlumbOAuthCredential,
  PlumbApiKeyCredential,
} from '@plumb/provider';

describe('OmpAuthSchemaKeychainAdapter', () => {
  let adapter: OmpAuthSchemaKeychainAdapter;

  beforeEach(() => {
    adapter = new OmpAuthSchemaKeychainAdapter();
  });
  afterEach(async () => {
    await adapter.clearAll();
  });

  it('preserves OMP auth schema: OAuth credential fields', async () => {
    const cred: PlumbOAuthCredential = {
      type: 'oauth',
      provider: 'anthropic',
      access: 'sk-ant-access-token',
      refresh: 'sk-ant-refresh-token',
      expires: Date.now() + 3600_000,
      email: 'user@example.com',
    };
    await adapter.storeOAuthCredential('anthropic', cred);
    const entries = await adapter.getCredentials('anthropic');
    expect(entries.length).toBe(1);
    const oauth = entries[0].credential as PlumbOAuthCredential;
    expect(oauth.type).toBe('oauth');
    expect(oauth.provider).toBe('anthropic');
    expect(oauth.access).toBe('sk-ant-access-token');
    expect(oauth.refresh).toBe('sk-ant-refresh-token');
    expect(oauth.email).toBe('user@example.com');
    expect(typeof oauth.expires).toBe('number');
  });

  it('preserves OMP auth schema: API key credential fields', async () => {
    const cred: PlumbApiKeyCredential = {
      type: 'api_key',
      provider: 'openai',
      key: 'sk-openai-api-key',
    };
    await adapter.storeApiKeyCredential('openai', cred);
    const key = await adapter.getApiKey('openai');
    expect(key).toBe('sk-openai-api-key');
  });

  it('physical backend is OS keychain (no plaintext JSON)', () => {
    expect(adapter.getPhysicalBackend()).toBe('OS_KEYCHAIN');
  });

  it('provider-scoped logout does not affect unrelated accounts', async () => {
    await adapter.storeOAuthCredential('anthropic', {
      type: 'oauth',
      provider: 'anthropic',
      access: 'tok-a',
      refresh: 'ref-a',
      expires: Date.now() + 3600_000,
    });
    await adapter.storeOAuthCredential('openai-codex', {
      type: 'oauth',
      provider: 'openai-codex',
      access: 'tok-b',
      refresh: 'ref-b',
      expires: Date.now() + 3600_000,
    });
    await adapter.removeCredentials('anthropic');
    expect(await adapter.getCredentials('anthropic')).toEqual([]);
    expect((await adapter.getCredentials('openai-codex')).length).toBe(1);
  });

  it('credential expiry/refresh preserves expiry epoch', async () => {
    const expires = Date.now() + 7200_000;
    await adapter.storeOAuthCredential('github-copilot', {
      type: 'oauth',
      provider: 'github-copilot',
      access: 'gh-tok',
      refresh: 'gh-ref',
      expires,
    });
    const entries = await adapter.getCredentials('github-copilot');
    expect((entries[0].credential as PlumbOAuthCredential).expires).toBe(
      expires,
    );
  });
});

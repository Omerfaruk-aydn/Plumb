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

  describe('credential isolation matrix (zero cross-provider bleed)', () => {
    // Pairs the universal-provider-ecosystem plan calls out explicitly as
    // never allowed to bleed into each other, plus the two pairs this
    // session found to be the sharpest real risk: `anthropic`/`anthropic-api`
    // and `google`/`google-vertex` are distinct PLUMB provider ids that
    // resolve to the same (or a related) OMP registry/catalog backing —
    // resolvePlumbProviderId() must never be applied before a credential
    // lookup, or these would collapse onto one credential-store key.
    const ISOLATION_PAIRS: ReadonlyArray<[string, string]> = [
      ['openai', 'anthropic-api'],
      ['anthropic', 'anthropic-api'],
      ['google', 'google-vertex'],
      ['google-vertex', 'antigravity'],
      ['github-copilot', 'openai'],
      ['opencode-go', 'opencode-zen'],
      ['nvidia', 'openai'],
      ['openrouter', 'openai'],
    ];

    it.each(ISOLATION_PAIRS)(
      'a credential stored for %s is invisible under %s',
      async (providerA, providerB) => {
        await store.storeApiKeyCredential(providerA, {
          type: 'api_key',
          provider: providerA,
          key: `key-for-${providerA}`,
        });

        expect(await store.hasCredentials(providerB)).toBe(false);
        expect(await store.getApiKey(providerB)).toBeUndefined();
        expect(await store.getCredentials(providerB)).toEqual([]);

        // The original provider's credential must be untouched by the check.
        expect(await store.getApiKey(providerA)).toBe(`key-for-${providerA}`);
      },
    );

    it('anthropic (OAuth account) and anthropic-api (direct key) hold independent credentials simultaneously', async () => {
      await store.storeOAuthCredential('anthropic', {
        type: 'oauth',
        provider: 'anthropic',
        access: 'anthropic-oauth-access',
        refresh: 'anthropic-oauth-refresh',
        expires: Date.now() + 3600_000,
      });
      await store.storeApiKeyCredential('anthropic-api', {
        type: 'api_key',
        provider: 'anthropic-api',
        key: 'sk-ant-direct-key',
      });

      expect(await store.getApiKey('anthropic-api')).toBe('sk-ant-direct-key');
      // `anthropic` holds its own OAuth credential, isolated from
      // `anthropic-api`'s direct key — getApiKey returns the OAuth access
      // token for it, never the other provider id's key.
      expect(await store.getApiKey('anthropic')).toBe('anthropic-oauth-access');
      const anthropicEntries = await store.getCredentials('anthropic');
      expect(anthropicEntries).toHaveLength(1);
      expect(
        (anthropicEntries[0].credential as PlumbOAuthCredential).access,
      ).toBe('anthropic-oauth-access');

      await store.removeCredentials('anthropic');
      expect(await store.hasCredentials('anthropic')).toBe(false);
      expect(await store.getApiKey('anthropic-api')).toBe('sk-ant-direct-key');
    });

    it('storing credentials for every isolation-matrix provider leaves each independently retrievable', async () => {
      const providers = [
        'openai',
        'anthropic',
        'anthropic-api',
        'google',
        'google-vertex',
        'antigravity',
        'github-copilot',
        'opencode-go',
        'opencode-zen',
        'nvidia',
        'openrouter',
      ];
      for (const provider of providers) {
        await store.storeApiKeyCredential(provider, {
          type: 'api_key',
          provider,
          key: `key-${provider}`,
        });
      }
      for (const provider of providers) {
        expect(await store.getApiKey(provider)).toBe(`key-${provider}`);
      }
    });
  });

  describe('safe cloud provider configuration (never secret material)', () => {
    it('getProviderCloudConfig returns {} for a provider with no configuration', async () => {
      expect(await store.getProviderCloudConfig('oci-genai')).toEqual({});
    });

    it('setProviderCloudConfig merges partial updates without clobbering existing keys', async () => {
      await store.setProviderCloudConfig('oci-genai', {
        region: 'us-chicago-1',
        projectId: 'ocid1.generativeaiproject.oc1..real',
      });
      await store.setProviderCloudConfig('oci-genai', {
        compartmentId: 'ocid1.compartment.oc1..real',
      });
      expect(await store.getProviderCloudConfig('oci-genai')).toEqual({
        region: 'us-chicago-1',
        projectId: 'ocid1.generativeaiproject.oc1..real',
        compartmentId: 'ocid1.compartment.oc1..real',
      });
    });

    it('setProviderCloudConfig with an undefined value removes that key -- used when switching auth mode/scope makes a field irrelevant', async () => {
      await store.setProviderCloudConfig('watsonx', {
        projectId: 'proj-1',
        spaceId: undefined,
      });
      await store.setProviderCloudConfig('watsonx', {
        projectId: undefined,
        spaceId: 'space-1',
      });
      expect(await store.getProviderCloudConfig('watsonx')).toEqual({
        spaceId: 'space-1',
      });
    });

    it('replaceProviderCloudConfig atomically replaces the whole config -- no partial old+new mix', async () => {
      await store.setProviderCloudConfig('oci-genai', {
        region: 'us-chicago-1',
        projectId: 'old-project',
        compartmentId: 'old-compartment',
      });
      await store.replaceProviderCloudConfig('oci-genai', {
        region: 'eu-frankfurt-1',
        projectId: 'new-project',
      });
      expect(await store.getProviderCloudConfig('oci-genai')).toEqual({
        region: 'eu-frankfurt-1',
        projectId: 'new-project',
      });
    });

    it('clearProviderCloudConfig removes all safe config for a provider -- part of remove/logout', async () => {
      await store.setProviderCloudConfig('azure', {
        endpoint: 'https://my-resource.openai.azure.com',
      });
      await store.clearProviderCloudConfig('azure');
      expect(await store.getProviderCloudConfig('azure')).toEqual({});
    });

    it('cloud config for one provider is independent of another (no cross-provider bleed)', async () => {
      await store.setProviderCloudConfig('oci-genai', {
        region: 'us-chicago-1',
      });
      await store.setProviderCloudConfig('watsonx', { region: 'eu-de' });
      expect(await store.getProviderCloudConfig('oci-genai')).toEqual({
        region: 'us-chicago-1',
      });
      expect(await store.getProviderCloudConfig('watsonx')).toEqual({
        region: 'eu-de',
      });
    });

    it('survives a fresh store instance reading the same persisted file (cold-restart durability)', async () => {
      await store.setProviderCloudConfig('amazon-bedrock', {
        region: 'us-west-2',
        profile: 'plumb-prod',
      });

      const restarted = new PlumbSecureCredentialStore();
      expect(await restarted.getProviderCloudConfig('amazon-bedrock')).toEqual({
        region: 'us-west-2',
        profile: 'plumb-prod',
      });
    });

    it('never appears in getCredentials/getApiKey -- safe config and secret material stay in separate stores', async () => {
      await store.setProviderCloudConfig('oci-genai', {
        region: 'us-chicago-1',
      });
      await store.storeApiKeyCredential('oci-genai', {
        type: 'api_key',
        provider: 'oci-genai',
        key: 'real-oci-genai-secret-key',
      });
      const config = await store.getProviderCloudConfig('oci-genai');
      expect(JSON.stringify(config)).not.toContain('real-oci-genai-secret-key');
      expect(await store.getApiKey('oci-genai')).toBe(
        'real-oci-genai-secret-key',
      );
    });
  });

  describe('namespace isolation: CREDENTIAL ENTRY != SAFE PROVIDER CONFIG ENTRY', () => {
    it('replacing a credential (remove then storeApiKeyCredential -- the real edit-mode "Replace credential" flow) leaves safe config untouched', async () => {
      await store.setProviderCloudConfig('oci-genai', {
        region: 'us-chicago-1',
        projectId: 'ocid1.generativeaiproject.oc1..real',
      });
      await store.storeApiKeyCredential('oci-genai', {
        type: 'api_key',
        provider: 'oci-genai',
        key: 'old-key',
      });

      // The real "Replace credential" edit-mode flow: remove the old
      // credential, then store the new one (api_key credentials are not
      // deduped/pruned by storeCredential the way OAuth credentials are --
      // that's existing, intentional multi-account behavior, out of scope
      // here; this is the deterministic replace sequence the UI uses).
      await store.removeCredentials('oci-genai');
      await store.storeApiKeyCredential('oci-genai', {
        type: 'api_key',
        provider: 'oci-genai',
        key: 'new-key',
      });

      expect(await store.getApiKey('oci-genai')).toBe('new-key');
      expect(await store.getProviderCloudConfig('oci-genai')).toEqual({
        region: 'us-chicago-1',
        projectId: 'ocid1.generativeaiproject.oc1..real',
      });
    });

    it('an expired OAuth credential (getApiKey returns undefined) leaves safe config untouched', async () => {
      await store.setProviderCloudConfig('watsonx', { region: 'eu-de' });
      await store.storeOAuthCredential('watsonx', {
        type: 'oauth',
        provider: 'watsonx',
        access: 'expired-access-token',
        refresh: 'refresh-token',
        expires: Date.now() - 3600_000, // already expired
      });

      expect(await store.getApiKey('watsonx')).toBeUndefined();
      expect(await store.getProviderCloudConfig('watsonx')).toEqual({
        region: 'eu-de',
      });
    });

    it('credential logout (removeCredentials) does not implicitly clear safe provider config -- these are separate, explicit operations', async () => {
      await store.setProviderCloudConfig('oci-genai', {
        region: 'us-chicago-1',
      });
      await store.storeApiKeyCredential('oci-genai', {
        type: 'api_key',
        provider: 'oci-genai',
        key: 'real-key',
      });

      await store.removeCredentials('oci-genai');

      expect(await store.hasCredentials('oci-genai')).toBe(false);
      // Safe config survives an explicit credential-only logout -- clearing
      // it requires the separate, explicit clearProviderCloudConfig call
      // (part of full provider removal), never implied by credential
      // removal alone.
      expect(await store.getProviderCloudConfig('oci-genai')).toEqual({
        region: 'us-chicago-1',
      });
    });

    it('removeCredential (single-type removal) does not touch safe provider config', async () => {
      await store.setProviderCloudConfig('azure', {
        endpoint: 'https://my-resource.openai.azure.com',
      });
      await store.storeApiKeyCredential('azure', {
        type: 'api_key',
        provider: 'azure',
        key: 'azure-key',
      });

      await store.removeCredential('azure', 'api_key');

      expect(await store.getProviderCloudConfig('azure')).toEqual({
        endpoint: 'https://my-resource.openai.azure.com',
      });
    });

    it('atomically replacing safe config (replaceProviderCloudConfig) leaves the secret credential untouched', async () => {
      await store.storeApiKeyCredential('oci-genai', {
        type: 'api_key',
        provider: 'oci-genai',
        key: 'real-key',
      });
      await store.setProviderCloudConfig('oci-genai', {
        region: 'us-chicago-1',
      });

      await store.replaceProviderCloudConfig('oci-genai', {
        region: 'ap-mumbai-1',
        projectId: 'ocid1.generativeaiproject.oc1..new',
      });

      expect(await store.getApiKey('oci-genai')).toBe('real-key');
      expect(await store.getProviderCloudConfig('oci-genai')).toEqual({
        region: 'ap-mumbai-1',
        projectId: 'ocid1.generativeaiproject.oc1..new',
      });
    });

    it('clearProviderCloudConfig (explicit provider removal) leaves the secret credential untouched -- config and credential clearing are independent operations', async () => {
      await store.setProviderCloudConfig('oci-genai', {
        region: 'us-chicago-1',
      });
      await store.storeApiKeyCredential('oci-genai', {
        type: 'api_key',
        provider: 'oci-genai',
        key: 'real-key',
      });

      await store.clearProviderCloudConfig('oci-genai');

      expect(await store.getProviderCloudConfig('oci-genai')).toEqual({});
      expect(await store.getApiKey('oci-genai')).toBe('real-key');
    });

    it('clearAll clears both namespaces together (the one operation that legitimately spans both)', async () => {
      await store.setProviderCloudConfig('oci-genai', {
        region: 'us-chicago-1',
      });
      await store.storeApiKeyCredential('oci-genai', {
        type: 'api_key',
        provider: 'oci-genai',
        key: 'real-key',
      });

      await store.clearAll();

      expect(await store.getProviderCloudConfig('oci-genai')).toEqual({});
      expect(await store.getApiKey('oci-genai')).toBeUndefined();
    });
  });
});

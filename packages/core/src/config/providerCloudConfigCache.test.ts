/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlumbSecureCredentialStore } from '../auth/plumbSecureCredentialStore.js';
import {
  initializeProviderCloudConfigCache,
  saveProviderCloudConfig,
  clearProviderCloudConfig,
  getCachedProviderCloudConfig,
  __resetProviderCloudConfigCacheForTests,
} from './providerCloudConfigCache.js';
import { resolveProviderConfigValue, getCatalogModels } from '@plumb/provider';

describe('providerCloudConfigCache', () => {
  let store: PlumbSecureCredentialStore;
  let isolatedHome: string;
  let previousHome: string | undefined;

  beforeEach(async () => {
    isolatedHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'plumb-cloud-config-cache-test-'),
    );
    previousHome = process.env['PLUMB_CLI_HOME'];
    process.env['PLUMB_CLI_HOME'] = isolatedHome;

    store = new PlumbSecureCredentialStore();
    await store.clearAll();
    __resetProviderCloudConfigCacheForTests();
  });

  afterEach(async () => {
    __resetProviderCloudConfigCacheForTests();
    await store.clearAll();
    if (previousHome === undefined) {
      delete process.env['PLUMB_CLI_HOME'];
    } else {
      process.env['PLUMB_CLI_HOME'] = previousHome;
    }
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  });

  it('initializeProviderCloudConfigCache loads real persisted config from the store into the cache', async () => {
    await store.setProviderCloudConfig('oci-genai', {
      region: 'us-chicago-1',
    });
    await initializeProviderCloudConfigCache(store);
    expect(getCachedProviderCloudConfig('oci-genai')).toEqual({
      region: 'us-chicago-1',
    });
  });

  it('wires the real resolver into packages/provider -- resolveProviderConfigValue sees the loaded config', async () => {
    await store.setProviderCloudConfig('watsonx', { region: 'eu-de' });
    await initializeProviderCloudConfigCache(store);
    expect(
      resolveProviderConfigValue(
        'watsonx',
        'region',
        'WATSONX_REGION_TEST_UNUSED',
        'us-south',
      ),
    ).toBe('eu-de');
  });

  it('saveProviderCloudConfig writes through to the store AND updates the cache immediately (no restart needed)', async () => {
    await initializeProviderCloudConfigCache(store);
    await saveProviderCloudConfig(
      'azure',
      { endpoint: 'https://my-resource.openai.azure.com' },
      store,
    );

    expect(getCachedProviderCloudConfig('azure')).toEqual({
      endpoint: 'https://my-resource.openai.azure.com',
    });
    // And it's really durable in the store, not just the in-memory cache.
    expect(await store.getProviderCloudConfig('azure')).toEqual({
      endpoint: 'https://my-resource.openai.azure.com',
    });
  });

  it('clearProviderCloudConfig clears both the store and the cache', async () => {
    await initializeProviderCloudConfigCache(store);
    await saveProviderCloudConfig(
      'amazon-bedrock',
      { region: 'us-west-2' },
      store,
    );
    await clearProviderCloudConfig('amazon-bedrock', store);

    expect(getCachedProviderCloudConfig('amazon-bedrock')).toEqual({});
    expect(await store.getProviderCloudConfig('amazon-bedrock')).toEqual({});
  });

  it('survives a fresh cache/resolver after simulated process restart (initialize re-reads the persisted store)', async () => {
    await initializeProviderCloudConfigCache(store);
    await saveProviderCloudConfig(
      'oci-genai',
      { region: 'ap-mumbai-1', compartmentId: 'ocid1.compartment.oc1..x' },
      store,
    );

    // Simulate a restart: drop the in-memory cache/resolver, then
    // re-initialize from the same persisted store.
    __resetProviderCloudConfigCacheForTests();
    const restartedStore = new PlumbSecureCredentialStore();
    await initializeProviderCloudConfigCache(restartedStore);

    expect(getCachedProviderCloudConfig('oci-genai')).toEqual({
      region: 'ap-mumbai-1',
      compartmentId: 'ocid1.compartment.oc1..x',
    });
    expect(
      resolveProviderConfigValue(
        'oci-genai',
        'region',
        'OCI_REGION_TEST_UNUSED',
      ),
    ).toBe('ap-mumbai-1');
  });

  it("one provider's saved config never bleeds into another provider's cache entry", async () => {
    await initializeProviderCloudConfigCache(store);
    await saveProviderCloudConfig(
      'oci-genai',
      { region: 'ap-mumbai-1' },
      store,
    );
    await saveProviderCloudConfig('watsonx', { region: 'eu-de' }, store);

    expect(getCachedProviderCloudConfig('oci-genai')).toEqual({
      region: 'ap-mumbai-1',
    });
    expect(getCachedProviderCloudConfig('watsonx')).toEqual({
      region: 'eu-de',
    });
  });

  it('all five Phase 4 cloud providers stay isolated from each other in the same cache (zero cross-provider bleed)', async () => {
    await initializeProviderCloudConfigCache(store);
    const perProvider: Record<string, Record<string, string>> = {
      'amazon-bedrock': { region: 'us-west-2' },
      azure: { endpoint: 'https://bleed-check.openai.azure.com' },
      'google-vertex': {
        projectId: 'bleed-check-project',
        location: 'us-central1',
      },
      watsonx: { region: 'eu-de', projectId: 'watsonx-bleed-check' },
      'oci-genai': {
        region: 'ap-mumbai-1',
        compartmentId: 'ocid1.compartment.oc1..bleed',
      },
    };

    for (const [providerId, config] of Object.entries(perProvider)) {
      await saveProviderCloudConfig(providerId, config, store);
    }

    for (const [providerId, config] of Object.entries(perProvider)) {
      expect(getCachedProviderCloudConfig(providerId)).toEqual(config);
      expect(await store.getProviderCloudConfig(providerId)).toEqual(config);
    }
  });

  describe('cold-start production-shaped regression', () => {
    it('a fresh process that initializes the cache BEFORE the first catalog call resolves persisted OCI config on that very first call -- no second-request self-healing', async () => {
      // 1. Persist OCI config (as if a prior session's setup UX saved it).
      await store.setProviderCloudConfig('oci-genai', {
        region: 'ap-mumbai-1',
        compartmentId: 'ocid1.compartment.oc1..real',
      });

      // 2. Destroy all relevant runtime/cache instances (simulate process
      // death -- the module-level cache/resolver from any prior test/run
      // must not leak in).
      __resetProviderCloudConfigCacheForTests();

      // 3. Construct a fresh store instance and initialize production
      // startup exactly like plumbInit.ts does, in the same order: load
      // the cloud config cache BEFORE any catalog/model resolution runs.
      const freshStore = new PlumbSecureCredentialStore();
      await initializeProviderCloudConfigCache(freshStore);

      // 4. First real catalog resolution in this "process".
      const [model] = getCatalogModels('oci-genai');

      expect(model).toBeDefined();
      expect(model.baseUrl).toBe(
        'https://inference.generativeai.ap-mumbai-1.oci.oraclecloud.com/openai/v1',
      );
      expect(model.headers?.['opc-compartment-id']).toBe(
        'ocid1.compartment.oc1..real',
      );
    });

    it('ANTI-TAUTOLOGY: without startup cache initialization, the first catalog call falls back to the default region instead of the persisted one', async () => {
      await store.setProviderCloudConfig('oci-genai', {
        region: 'ap-mumbai-1',
      });
      // Deliberately skip initializeProviderCloudConfigCache() -- this is
      // the regression this whole matrix exists to prevent: PLUMB-saved
      // config exists on disk, but nothing loaded it into the resolver
      // before the first request.
      __resetProviderCloudConfigCacheForTests();

      const [model] = getCatalogModels('oci-genai');

      expect(model.baseUrl).not.toBe(
        'https://inference.generativeai.ap-mumbai-1.oci.oraclecloud.com/openai/v1',
      );
      expect(model.baseUrl).toBe(
        'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/openai/v1',
      );
    });
  });

  describe('initialization idempotency and failure isolation', () => {
    it('concurrent initialize calls (Promise.all) converge to the same correct state -- no duplicated listeners/entries/races', async () => {
      await store.setProviderCloudConfig('oci-genai', {
        region: 'ap-mumbai-1',
      });
      await store.setProviderCloudConfig('watsonx', { region: 'eu-de' });

      await Promise.all([
        initializeProviderCloudConfigCache(store),
        initializeProviderCloudConfigCache(store),
        initializeProviderCloudConfigCache(store),
      ]);

      expect(getCachedProviderCloudConfig('oci-genai')).toEqual({
        region: 'ap-mumbai-1',
      });
      expect(getCachedProviderCloudConfig('watsonx')).toEqual({
        region: 'eu-de',
      });
      expect(
        resolveProviderConfigValue('oci-genai', 'region', 'UNUSED_ENV'),
      ).toBe('ap-mumbai-1');
    });

    it('repeated initialize calls do not clear already-saved same-session configuration', async () => {
      await initializeProviderCloudConfigCache(store);
      await saveProviderCloudConfig(
        'oci-genai',
        { region: 'ap-mumbai-1' },
        store,
      );

      // A second startup-style initialize call (idempotent re-sync) must
      // not wipe out what was just saved in this session.
      await initializeProviderCloudConfigCache(store);

      expect(getCachedProviderCloudConfig('oci-genai')).toEqual({
        region: 'ap-mumbai-1',
      });
    });

    it('a store failure for one provider does not prevent other providers from loading, and never throws out of initialization', async () => {
      await store.setProviderCloudConfig('watsonx', { region: 'eu-de' });

      const failingStore = {
        getProviderCloudConfig: async (providerId: string) => {
          if (providerId === 'oci-genai') {
            throw new Error('simulated corrupt oci-genai config entry');
          }
          return store.getProviderCloudConfig(providerId);
        },
      } as unknown as PlumbSecureCredentialStore;

      await expect(
        initializeProviderCloudConfigCache(failingStore),
      ).resolves.not.toThrow();

      // The failing provider is treated as unconfigured, not left stale/undefined.
      expect(getCachedProviderCloudConfig('oci-genai')).toEqual({});
      // Every other provider, including the rest of the fixed cloud set,
      // still loaded correctly.
      expect(getCachedProviderCloudConfig('watsonx')).toEqual({
        region: 'eu-de',
      });
    });
  });
});

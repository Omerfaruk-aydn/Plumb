/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bridges PlumbSecureCredentialStore's async safe cloud-config storage to
 * packages/provider's synchronous resolver seam. Proves: startup load
 * populates the cache from the real store, save writes through and updates
 * the cache immediately (same-session effect, no restart needed), clear
 * removes both, and the wired resolver is what packages/provider's own
 * resolveProviderConfigValue actually consults end-to-end.
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
import { resolveProviderConfigValue } from '@google/gemini-cli-provider';

describe('providerCloudConfigCache', () => {
  let store: PlumbSecureCredentialStore;
  let isolatedHome: string;
  let previousHome: string | undefined;

  beforeEach(async () => {
    isolatedHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'plumb-cloud-config-cache-test-'),
    );
    previousHome = process.env['GEMINI_CLI_HOME'];
    process.env['GEMINI_CLI_HOME'] = isolatedHome;

    store = new PlumbSecureCredentialStore();
    await store.clearAll();
    __resetProviderCloudConfigCacheForTests();
  });

  afterEach(async () => {
    __resetProviderCloudConfigCacheForTests();
    await store.clearAll();
    if (previousHome === undefined) {
      delete process.env['GEMINI_CLI_HOME'];
    } else {
      process.env['GEMINI_CLI_HOME'] = previousHome;
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
});

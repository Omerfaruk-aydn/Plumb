/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bridges `PlumbSecureCredentialStore`'s async safe cloud-config storage
 * (`packages/core`) to `packages/provider`'s synchronous
 * `providerConfigResolver` seam. `packages/provider`'s catalog/transport
 * functions (getCatalogModels, streamWatsonx, etc.) are called
 * synchronously from many existing call sites across the codebase, so the
 * resolver they consult cannot itself be async -- this module owns the
 * one place that bridges the store's real async I/O into an in-memory
 * snapshot a synchronous resolver can read.
 *
 * Lifecycle: `initializeProviderCloudConfigCache()` must run once during
 * PLUMB startup (before any provider stream/catalog call), and
 * `saveProviderCloudConfig()` must be the only write path once the in-app
 * configuration UX exists, so the cache and the persisted store never
 * drift apart within a running process.
 */

import {
  getPlumbCredentialStore,
  type PlumbSecureCredentialStore,
} from '../auth/plumbSecureCredentialStore.js';
import { setProviderConfigResolver } from '@google/gemini-cli-provider';
import { debugLogger } from '../utils/debugLogger.js';

/**
 * The fixed set of PLUMB providers that support in-app safe configuration.
 * The storage namespace predates local endpoint configuration and retains
 * its `cloudConfig` name for compatibility, but its contents are simply
 * provider-scoped non-secret configuration.
 */
export const CLOUD_CONFIG_PROVIDER_IDS: readonly string[] = [
  'amazon-bedrock',
  'azure',
  'google-vertex',
  'watsonx',
  'oci-genai',
  'ollama',
  'lm-studio',
  'llama-cpp',
  'vllm',
  'sglang',
  'portkey',
  'litellm',
];

const cache = new Map<string, Readonly<Record<string, string>>>();
let initialized = false;

/**
 * Loads every known cloud provider's safe config from the credential store
 * into the in-memory cache and wires the synchronous resolver
 * `packages/provider` consults. Idempotent -- safe to call more than once
 * (e.g. once from CLI bootstrap, once from a test harness); each call
 * re-reads from the store, so it also serves as an explicit
 * "resync from disk" operation.
 */
export async function initializeProviderCloudConfigCache(
  store: PlumbSecureCredentialStore = getPlumbCredentialStore(),
): Promise<void> {
  for (const providerId of CLOUD_CONFIG_PROVIDER_IDS) {
    try {
      const config = await store.getProviderCloudConfig(providerId);
      cache.set(providerId, config);
    } catch (err) {
      // A corrupt/unreadable entry for ONE provider must never abort the
      // loop -- Bedrock/Azure/Vertex/watsonx/OCI (and every non-cloud
      // provider, which never touches this cache at all) must still
      // initialize normally. Treated as "not configured" for this
      // provider, never silently accepted as valid -- logged so a real
      // corruption is still visible.
      debugLogger.warn(
        `providerCloudConfigCache: failed to load safe config for '${providerId}', treating as unconfigured:`,
        err instanceof Error ? err.message : String(err),
      );
      cache.set(providerId, {});
    }
  }
  if (!initialized) {
    setProviderConfigResolver((providerId) => cache.get(providerId) ?? {});
    initialized = true;
  }
}

/**
 * Writes through the credential store, then refreshes this provider's
 * in-memory cache entry -- so a save takes effect for the very next
 * catalog/model-stream call in the same running process, not only after a
 * restart. This is the write path the future in-app configuration UX
 * calls; nothing else should call `PlumbSecureCredentialStore.
 * replaceProviderCloudConfig` directly, or the cache and the store can
 * drift apart within a session.
 */
export async function saveProviderCloudConfig(
  providerId: string,
  config: Record<string, string>,
  store: PlumbSecureCredentialStore = getPlumbCredentialStore(),
): Promise<void> {
  await store.replaceProviderCloudConfig(providerId, config);
  cache.set(providerId, { ...config });
}

/**
 * Clears this provider's cloud config from both the store and the cache --
 * part of remove/logout. Never touches external credential authorities
 * (AWS chain files, ADC, OCI profiles) -- only PLUMB's own reference.
 */
export async function clearProviderCloudConfig(
  providerId: string,
  store: PlumbSecureCredentialStore = getPlumbCredentialStore(),
): Promise<void> {
  await store.clearProviderCloudConfig(providerId);
  cache.set(providerId, {});
}

/** Synchronous read of the cached snapshot -- test/diagnostic use; the resolver seam is the real consumer. */
export function getCachedProviderCloudConfig(
  providerId: string,
): Readonly<Record<string, string>> {
  return cache.get(providerId) ?? {};
}

/** Test-only: drops the cache and un-wires the resolver. */
export function __resetProviderCloudConfigCacheForTests(): void {
  cache.clear();
  initialized = false;
  setProviderConfigResolver(undefined);
}

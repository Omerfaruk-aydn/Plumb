/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildLocalProviderSaveOperation,
  ensurePlumbCredentialStore,
  getLocalProviderConfigSchema,
  getLocalProviderEndpointDefinition,
  getPlumbModelRegistry,
  validateLocalProviderConfig,
  type CloudConfigFormValues,
} from '@plumb/provider';
import {
  createCloudConfigActions,
  type GenericCloudConfigActions,
} from './genericCloudConfigActions.js';

const actions = new Map<string, GenericCloudConfigActions>();

async function refreshLocalProvider(providerId: string): Promise<void> {
  const registry = getPlumbModelRegistry();
  registry.invalidateCache(providerId);
  let apiKey: string | undefined;
  try {
    const store = await ensurePlumbCredentialStore();
    apiKey = await store.getApiKey(providerId);
  } catch {
    // Keyless local discovery is valid.
  }
  await registry.discoverProviderModels(providerId, apiKey);
}

export function getLocalProviderConfigActions(
  providerId: string,
): GenericCloudConfigActions | undefined {
  const cached = actions.get(providerId);
  if (cached) return cached;
  const schema = getLocalProviderConfigSchema(providerId);
  const definition = getLocalProviderEndpointDefinition(providerId);
  if (!schema || !definition) return undefined;

  const base = createCloudConfigActions({
    providerId,
    schema,
    validate: (values: CloudConfigFormValues) =>
      validateLocalProviderConfig(providerId, values),
    buildSaveOperation: (values: CloudConfigFormValues) =>
      buildLocalProviderSaveOperation(providerId, values),
  });

  const wrapped: GenericCloudConfigActions = {
    ...base,
    async load() {
      const existing = await base.load();
      return {
        ...existing,
        safeConfig: {
          authMode: existing.safeConfig['authMode'] ?? 'none',
          baseUrl: existing.safeConfig['baseUrl'] ?? definition.defaultBaseUrl,
          ...existing.safeConfig,
        },
      };
    },
    async save(values) {
      const result = await base.save(values);
      if (result.success) await refreshLocalProvider(providerId);
      return result;
    },
    async remove() {
      await base.remove();
      await refreshLocalProvider(providerId);
    },
    async refresh() {
      await refreshLocalProvider(providerId);
    },
  };
  actions.set(providerId, wrapped);
  return wrapped;
}

/** Test-only: local action objects close over no secrets, but reset for mocks. */
export function __resetLocalProviderConfigActionsForTests(): void {
  actions.clear();
}

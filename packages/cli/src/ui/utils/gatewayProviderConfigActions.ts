/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildGatewayProviderSaveOperation,
  ensurePlumbCredentialStore,
  getGatewayProviderConfigSchema,
  getPlumbModelRegistry,
  resolveGatewayProviderBaseUrl,
  validateGatewayProviderConfig,
  type CloudConfigFormValues,
} from '@google/gemini-cli-provider';
import {
  createCloudConfigActions,
  type GenericCloudConfigActions,
} from './genericCloudConfigActions.js';

const actions = new Map<string, GenericCloudConfigActions>();

async function refreshGatewayProvider(providerId: string): Promise<void> {
  const registry = getPlumbModelRegistry();
  registry.invalidateCache(providerId);
  let apiKey: string | undefined;
  try {
    apiKey = await (await ensurePlumbCredentialStore()).getApiKey(providerId);
  } catch {
    // Keyless LiteLLM proxies are supported.
  }
  await registry.discoverProviderModels(providerId, apiKey);
}

export function getGatewayProviderConfigActions(
  providerId: string,
): GenericCloudConfigActions | undefined {
  const cached = actions.get(providerId);
  if (cached) return cached;
  const schema = getGatewayProviderConfigSchema(providerId);
  const defaultBaseUrl = resolveGatewayProviderBaseUrl(providerId);
  if (!schema || !defaultBaseUrl) return undefined;

  const base = createCloudConfigActions({
    providerId,
    schema,
    validate: (values: CloudConfigFormValues) =>
      validateGatewayProviderConfig(providerId, values),
    buildSaveOperation: (values: CloudConfigFormValues) =>
      buildGatewayProviderSaveOperation(providerId, values),
  });

  const wrapped: GenericCloudConfigActions = {
    ...base,
    async load() {
      const existing = await base.load();
      return {
        ...existing,
        safeConfig: {
          baseUrl: existing.safeConfig['baseUrl'] ?? defaultBaseUrl,
          ...existing.safeConfig,
        },
      };
    },
    async save(values) {
      const result = await base.save(values);
      if (result.success) await refreshGatewayProvider(providerId);
      return result;
    },
    async remove() {
      await base.remove();
      await refreshGatewayProvider(providerId);
    },
    async refresh() {
      await refreshGatewayProvider(providerId);
    },
  };
  actions.set(providerId, wrapped);
  return wrapped;
}

export function __resetGatewayProviderConfigActionsForTests(): void {
  actions.clear();
}

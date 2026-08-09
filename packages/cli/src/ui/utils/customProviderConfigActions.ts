/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * CRUD orchestration for user-defined custom providers. Unlike the flat
 * single-secret cloud providers (bedrockCloudConfigActions.ts and friends),
 * a custom provider is one of many entries in the durable
 * `CustomProviderDefinitionStore` list, so every write here re-hydrates the
 * in-memory definition table and the model registry's manual-model snapshot
 * immediately -- the running session must reflect an edit or delete without
 * a restart, the same guarantee cold start gets from plumbInit.
 */
import {
  createCustomProviderId,
  getPlumbModelRegistry,
  getPlumbProviderRegistry,
  setCustomProviderDefinitions,
  validateCustomProviderDefinition,
  type CustomProviderDefinition,
  type CustomProviderDefinitionInput,
  type CustomProviderValidationErrors,
} from '@google/gemini-cli-provider';
import {
  getCustomProviderDefinitionStore,
  type CustomProviderDefinitionStore,
} from '@google/gemini-cli-core';

export interface CustomProviderSaveResult {
  success: boolean;
  error?: string;
  fieldErrors?: CustomProviderValidationErrors;
  definition?: CustomProviderDefinition;
}

async function rehydrate(
  store: CustomProviderDefinitionStore,
): Promise<CustomProviderDefinition[]> {
  const definitions = await store.load();
  setCustomProviderDefinitions(definitions);
  getPlumbModelRegistry().hydrateCustomProviderModels();
  return definitions;
}

export interface CustomProviderConfigActions {
  list(): Promise<CustomProviderDefinition[]>;
  save(
    input: CustomProviderDefinitionInput,
    apiKey?: string,
  ): Promise<CustomProviderSaveResult>;
  remove(providerId: string): Promise<void>;
  hasCredential(providerId: string): Promise<boolean>;
}

export function createCustomProviderConfigActions(
  store: CustomProviderDefinitionStore = getCustomProviderDefinitionStore(),
): CustomProviderConfigActions {
  async function list(): Promise<CustomProviderDefinition[]> {
    return rehydrate(store);
  }

  async function save(
    input: CustomProviderDefinitionInput,
    apiKey?: string,
  ): Promise<CustomProviderSaveResult> {
    const id = input.id ?? createCustomProviderId();
    const withId = { ...input, id };
    const fieldErrors = validateCustomProviderDefinition(withId);
    if (Object.keys(fieldErrors).length > 0) {
      return {
        success: false,
        error: Object.values(fieldErrors)[0],
        fieldErrors,
      };
    }

    if (apiKey) {
      try {
        const registry = getPlumbProviderRegistry();
        await registry.initialize();
        await registry.setAuthenticated(id, {
          type: 'api_key',
          provider: id,
          key: apiKey,
        });
      } catch (err) {
        return {
          success: false,
          error: `Failed to save credential: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    let definition: CustomProviderDefinition;
    try {
      definition = await store.upsert(withId);
    } catch (err) {
      return {
        success: false,
        error: `Failed to save configuration: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    await rehydrate(store);
    return { success: true, definition };
  }

  async function remove(providerId: string): Promise<void> {
    await store.delete(providerId);
    await rehydrate(store);
    try {
      const registry = getPlumbProviderRegistry();
      await registry.initialize();
      await registry.logout(providerId);
    } catch {
      // Best-effort -- the definition removal above is the primary
      // guarantee; a missing/unsupported credential entry is not an error.
    }
  }

  async function hasCredential(providerId: string): Promise<boolean> {
    try {
      const registry = getPlumbProviderRegistry();
      await registry.initialize();
      const state = registry.getProviderState?.(providerId);
      return state?.credentials?.type === 'api_key';
    } catch {
      return false;
    }
  }

  return { list, save, remove, hasCredential };
}

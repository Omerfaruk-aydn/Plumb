/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ensurePlumbCredentialStore,
  getPlumbProviderRegistry,
  resolveProviderSafeConfig,
  resolveProviderConfigValue,
  type CloudProviderConfigSchema,
  type CloudConfigFormValues,
  type CloudConfigValidationErrors,
} from '@plumb/provider';

export type CloudFieldConfigSource = 'plumb' | 'env' | 'none';

export interface CloudSaveResult {
  success: boolean;
  error?: string;
  fieldErrors?: CloudConfigValidationErrors;
}

export interface CloudExistingConfig {
  safeConfig: Record<string, string>;
  hasCredential: boolean;
  sources: Record<string, CloudFieldConfigSource>;
}

export interface GenericCloudConfigActions {
  save(values: CloudConfigFormValues): Promise<CloudSaveResult>;
  load(): Promise<CloudExistingConfig>;
  remove(): Promise<void>;
  refresh(): Promise<void>;
  clearOverrides(): Promise<void>;
  getFieldSources(): Record<string, CloudFieldConfigSource>;
}

/** Every non-secret field with an envVar, across every auth mode -- the set eligible for the PLUMB-override > env precedence and the "Clear PLUMB override" action. */
function collectOverridableFields(
  schema: CloudProviderConfigSchema,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const mode of schema.authModes) {
    for (const field of mode.fields) {
      if (!field.secret && field.envVar) {
        out[field.id] = field.envVar;
      }
    }
  }
  return out;
}

export function createCloudConfigActions(opts: {
  providerId: string;
  schema: CloudProviderConfigSchema;
  validate: (values: CloudConfigFormValues) => CloudConfigValidationErrors;
  buildSaveOperation: (values: CloudConfigFormValues) => {
    safeConfig: Record<string, string>;
    credential?: string;
  };
}): GenericCloudConfigActions {
  const { providerId, schema, validate, buildSaveOperation } = opts;
  const overridableFields = collectOverridableFields(schema);

  function getFieldSources(): Record<string, CloudFieldConfigSource> {
    const safeConfig = resolveProviderSafeConfig(providerId);
    const sources: Record<string, CloudFieldConfigSource> = {};
    for (const [field, envVar] of Object.entries(overridableFields)) {
      if (safeConfig[field]?.trim()) {
        sources[field] = 'plumb';
      } else if (process.env[envVar]?.trim()) {
        sources[field] = 'env';
      } else {
        sources[field] = 'none';
      }
    }
    return sources;
  }

  async function save(values: CloudConfigFormValues): Promise<CloudSaveResult> {
    const fieldErrors = validate(values);
    if (Object.keys(fieldErrors).length > 0) {
      const firstError = Object.values(fieldErrors)[0];
      return { success: false, error: firstError, fieldErrors };
    }

    const { safeConfig, credential } = buildSaveOperation(values);

    if (credential) {
      try {
        const registry = getPlumbProviderRegistry();
        await registry.initialize();
        await registry.setAuthenticated(providerId, {
          type: 'api_key',
          provider: providerId,
          key: credential,
        });
      } catch (err) {
        return {
          success: false,
          error: `Failed to save credential: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    try {
      const { saveProviderCloudConfig } = await import('@plumb/core');
      await saveProviderCloudConfig(providerId, safeConfig);
    } catch (err) {
      return {
        success: false,
        error: `Failed to save configuration: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    return { success: true };
  }

  async function load(): Promise<CloudExistingConfig> {
    const { getCachedProviderCloudConfig } = await import('@plumb/core');
    const safeConfig = { ...getCachedProviderCloudConfig(providerId) };
    for (const [field, envVar] of Object.entries(overridableFields)) {
      const effective = resolveProviderConfigValue(providerId, field, envVar);
      if (effective) safeConfig[field] = effective;
    }
    let hasCredential = false;
    try {
      const store = await ensurePlumbCredentialStore();
      hasCredential = await store.hasCredentials(providerId);
    } catch {
      hasCredential = false;
    }
    return { safeConfig, hasCredential, sources: getFieldSources() };
  }

  async function remove(): Promise<void> {
    const { clearProviderCloudConfig } = await import('@plumb/core');
    await clearProviderCloudConfig(providerId);
    try {
      const store = await ensurePlumbCredentialStore();
      await store.removeCredentials(providerId);
    } catch {
      // Best-effort -- safe config removal above is the primary guarantee.
    }
  }

  async function refresh(): Promise<void> {
    const { removeOmpModelCacheEntry } = await import('@plumb/provider');
    removeOmpModelCacheEntry(providerId);
  }

  async function clearOverrides(): Promise<void> {
    const [{ getCachedProviderCloudConfig, saveProviderCloudConfig }] =
      await Promise.all([import('@plumb/core')]);
    const current = { ...getCachedProviderCloudConfig(providerId) };
    for (const field of Object.keys(overridableFields)) {
      delete current[field];
    }
    await saveProviderCloudConfig(providerId, current);
  }

  return { save, load, remove, refresh, clearOverrides, getFieldSources };
}

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  validateAzureConfig,
  buildAzureSaveOperation,
  decodeAzureDeploymentMap,
  decodeAzureEndpoint,
  type AzureConfigFormValues,
  type AzureConfigValidationErrors,
  type AzureDeployment,
} from '@plumb/provider';

const AZURE_PROVIDER_ID = 'azure';

export interface AzureSaveResult {
  success: boolean;
  error?: string;
  fieldErrors?: AzureConfigValidationErrors;
}

export async function saveAzureConfiguration(
  values: AzureConfigFormValues,
): Promise<AzureSaveResult> {
  const fieldErrors = validateAzureConfig(values);
  if (Object.keys(fieldErrors).length > 0) {
    const firstError = Object.values(fieldErrors)[0];
    return { success: false, error: firstError, fieldErrors };
  }

  const { safeConfig, credential } = buildAzureSaveOperation(values);

  if (credential) {
    try {
      const { ensurePlumbCredentialStore } = await import('@plumb/provider');
      const store = await ensurePlumbCredentialStore();
      await store.storeApiKeyCredential(AZURE_PROVIDER_ID, {
        type: 'api_key',
        provider: AZURE_PROVIDER_ID,
        key: credential,
      });
    } catch (err) {
      return {
        success: false,
        error: `Failed to save Azure credential: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  try {
    const { saveProviderCloudConfig } = await import('@plumb/core');
    await saveProviderCloudConfig(AZURE_PROVIDER_ID, safeConfig);
  } catch (err) {
    return {
      success: false,
      error: `Failed to save Azure configuration: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { success: true };
}

export interface AzureExistingConfig {
  endpoint: string;
  deployments: AzureDeployment[];
  hasCredential: boolean;
}

export async function loadAzureExistingConfig(): Promise<AzureExistingConfig> {
  const [{ getCachedProviderCloudConfig }, { ensurePlumbCredentialStore }] =
    await Promise.all([import('@plumb/core'), import('@plumb/provider')]);
  const safeConfig = getCachedProviderCloudConfig(AZURE_PROVIDER_ID);
  const endpoint = decodeAzureEndpoint(safeConfig as Record<string, string>);
  const deployments = decodeAzureDeploymentMap(safeConfig['deploymentMap']);
  let hasCredential = false;
  try {
    const store = await ensurePlumbCredentialStore();
    hasCredential = await store.hasCredentials(AZURE_PROVIDER_ID);
  } catch {
    hasCredential = false;
  }
  return { endpoint, deployments, hasCredential };
}

export async function removeAzureConfiguration(): Promise<void> {
  const [{ clearProviderCloudConfig }, { ensurePlumbCredentialStore }] =
    await Promise.all([import('@plumb/core'), import('@plumb/provider')]);
  await clearProviderCloudConfig(AZURE_PROVIDER_ID);
  try {
    const store = await ensurePlumbCredentialStore();
    await store.removeCredentials(AZURE_PROVIDER_ID);
  } catch {
    // Best-effort -- safe config removal above is the primary guarantee.
  }
}

export async function refreshAzureModelStatus(): Promise<void> {
  const { removeOmpModelCacheEntry } = await import('@plumb/provider');
  removeOmpModelCacheEntry(AZURE_PROVIDER_ID);
}

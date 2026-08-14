/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  validateOciConfig,
  buildOciSaveOperation,
  resolveProviderSafeConfig,
  resolveProviderConfigValue,
  type OciConfigFormValues,
  type OciConfigValidationErrors,
} from '@plumb/provider';

const OCI_PROVIDER_ID = 'oci-genai';
const OCI_DEFAULT_REGION = 'us-chicago-1';

/** The overridable safe-config keys with a documented environment fallback. */
const OVERRIDABLE_FIELD_ENV_VARS: Record<string, string> = {
  region: 'OCI_REGION',
  projectId: 'OCI_GENAI_PROJECT_ID',
  compartmentId: 'OCI_COMPARTMENT_ID',
};

export type OciFieldConfigSource = 'plumb' | 'env' | 'none';

/**
 * Where each overridable field's *effective* value currently comes from --
 * a PLUMB-saved override, an environment variable fallback, or neither.
 * Mirrors resolveProviderConfigValue's own precedence (PLUMB config > env)
 * without re-implementing it.
 */
export function getOciFieldSources(): Record<string, OciFieldConfigSource> {
  const safeConfig = resolveProviderSafeConfig(OCI_PROVIDER_ID);
  const sources: Record<string, OciFieldConfigSource> = {};
  for (const [field, envVar] of Object.entries(OVERRIDABLE_FIELD_ENV_VARS)) {
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

export interface OciSaveResult {
  success: boolean;
  error?: string;
  fieldErrors?: OciConfigValidationErrors;
}

/**
 * validate -> persist secret (if a new one was entered) -> persist safe
 * config -> refresh the in-memory resolver cache -> invalidate model
 * discovery, in that order. If the secret write fails, the safe config is
 * never written (no partial "looks configured but the key never saved"
 * state). If the safe config write fails after a credential was written,
 * that is surfaced as a failure too -- the caller must not report success.
 */
export async function saveOciConfiguration(
  values: OciConfigFormValues,
): Promise<OciSaveResult> {
  const fieldErrors = validateOciConfig(values);
  if (Object.keys(fieldErrors).length > 0) {
    const firstError = Object.values(fieldErrors)[0];
    return { success: false, error: firstError, fieldErrors };
  }

  const { safeConfig, credential } = buildOciSaveOperation(values);

  if (credential) {
    try {
      const { ensurePlumbCredentialStore } = await import('@plumb/provider');
      const store = await ensurePlumbCredentialStore();
      await store.storeApiKeyCredential(OCI_PROVIDER_ID, {
        type: 'api_key',
        provider: OCI_PROVIDER_ID,
        key: credential,
      });
    } catch (err) {
      return {
        success: false,
        error: `Failed to save OCI credential: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  try {
    const { saveProviderCloudConfig } = await import('@plumb/core');
    await saveProviderCloudConfig(OCI_PROVIDER_ID, safeConfig);
  } catch (err) {
    return {
      success: false,
      error: `Failed to save OCI configuration: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { success: true };
}

export interface OciExistingConfig {
  safeConfig: Record<string, string>;
  hasCredential: boolean;
  /** Per-field provenance (PLUMB-saved override vs environment vs neither) for region/projectId/compartmentId. */
  sources: Record<string, OciFieldConfigSource>;
}

/**
 * Reads back the persisted safe config + credential presence for edit-mode
 * initialization. Never returns the raw credential value. region/projectId/
 * compartmentId are resolved to their *effective* value (PLUMB override,
 * else environment variable, else -- for region only -- the built-in
 * default) so the screen always reflects what the provider will actually
 * use, not just what PLUMB happens to have persisted; `sources` says which
 * of those two the effective value came from.
 */
export async function loadOciExistingConfig(): Promise<OciExistingConfig> {
  const [{ getCachedProviderCloudConfig }, { ensurePlumbCredentialStore }] =
    await Promise.all([import('@plumb/core'), import('@plumb/provider')]);
  const safeConfig = { ...getCachedProviderCloudConfig(OCI_PROVIDER_ID) };
  const effectiveRegion = resolveProviderConfigValue(
    OCI_PROVIDER_ID,
    'region',
    'OCI_REGION',
    OCI_DEFAULT_REGION,
  );
  if (effectiveRegion) safeConfig['region'] = effectiveRegion;
  const effectiveProjectId = resolveProviderConfigValue(
    OCI_PROVIDER_ID,
    'projectId',
    'OCI_GENAI_PROJECT_ID',
  );
  if (effectiveProjectId) safeConfig['projectId'] = effectiveProjectId;
  const effectiveCompartmentId = resolveProviderConfigValue(
    OCI_PROVIDER_ID,
    'compartmentId',
    'OCI_COMPARTMENT_ID',
  );
  if (effectiveCompartmentId)
    safeConfig['compartmentId'] = effectiveCompartmentId;
  let hasCredential = false;
  try {
    const store = await ensurePlumbCredentialStore();
    hasCredential = await store.hasCredentials(OCI_PROVIDER_ID);
  } catch {
    hasCredential = false;
  }
  return { safeConfig, hasCredential, sources: getOciFieldSources() };
}

/** Removes PLUMB-owned OCI configuration + credential. Never touches external OCI config files/profiles/principal state. */
export async function removeOciConfiguration(): Promise<void> {
  const [{ clearProviderCloudConfig }, { ensurePlumbCredentialStore }] =
    await Promise.all([import('@plumb/core'), import('@plumb/provider')]);
  await clearProviderCloudConfig(OCI_PROVIDER_ID);
  try {
    const store = await ensurePlumbCredentialStore();
    await store.removeCredentials(OCI_PROVIDER_ID);
  } catch {
    // Best-effort -- safe config removal above is the primary guarantee.
  }
}

/**
 * Removes the PLUMB-saved override for region/projectId/compartmentId --
 * NOT a full remove: authMode/iamAuthMode/credential are left untouched.
 * The next resolution for these fields falls through to their environment
 * variable (or the built-in default), effective for the current process
 * immediately (saveProviderCloudConfig refreshes the in-memory resolver
 * cache synchronously) -- no restart required.
 */
export async function clearOciConfigOverrides(): Promise<void> {
  const [{ getCachedProviderCloudConfig, saveProviderCloudConfig }] =
    await Promise.all([import('@plumb/core')]);
  const current = { ...getCachedProviderCloudConfig(OCI_PROVIDER_ID) };
  for (const field of Object.keys(OVERRIDABLE_FIELD_ENV_VARS)) {
    delete current[field];
  }
  await saveProviderCloudConfig(OCI_PROVIDER_ID, current);
}

/**
 * Drops OCI's cached model-discovery entry so the next model lookup
 * re-discovers against the currently configured region/auth instead of
 * serving a stale list from before the user changed their configuration.
 * An explicit user action only -- never triggered by mere navigation.
 */
export async function refreshOciModelStatus(): Promise<void> {
  const { removeOmpModelCacheEntry } = await import('@plumb/provider');
  removeOmpModelCacheEntry(OCI_PROVIDER_ID);
}

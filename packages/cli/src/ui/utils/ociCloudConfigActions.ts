/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical OCI configuration save/load orchestration -- the ONLY place
 * that persists OCI safe config/credentials or reads them back for edit
 * mode. React (PlumbCloudProviderConfigForm) calls these; it never
 * constructs raw credential-store/cache calls itself.
 */
import {
  validateOciConfig,
  buildOciSaveOperation,
  type OciConfigFormValues,
  type OciConfigValidationErrors,
} from '@google/gemini-cli-provider';

const OCI_PROVIDER_ID = 'oci-genai';

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
      const { ensurePlumbCredentialStore } = await import(
        '@google/gemini-cli-provider'
      );
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
    const { saveProviderCloudConfig } = await import('@google/gemini-cli-core');
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
}

/** Reads back the persisted safe config + credential presence for edit-mode initialization. Never returns the raw credential value. */
export async function loadOciExistingConfig(): Promise<OciExistingConfig> {
  const [{ getCachedProviderCloudConfig }, { ensurePlumbCredentialStore }] =
    await Promise.all([
      import('@google/gemini-cli-core'),
      import('@google/gemini-cli-provider'),
    ]);
  const safeConfig = { ...getCachedProviderCloudConfig(OCI_PROVIDER_ID) };
  let hasCredential = false;
  try {
    const store = await ensurePlumbCredentialStore();
    hasCredential = await store.hasCredentials(OCI_PROVIDER_ID);
  } catch {
    hasCredential = false;
  }
  return { safeConfig, hasCredential };
}

/** Removes PLUMB-owned OCI configuration + credential. Never touches external OCI config files/profiles/principal state. */
export async function removeOciConfiguration(): Promise<void> {
  const [{ clearProviderCloudConfig }, { ensurePlumbCredentialStore }] =
    await Promise.all([
      import('@google/gemini-cli-core'),
      import('@google/gemini-cli-provider'),
    ]);
  await clearProviderCloudConfig(OCI_PROVIDER_ID);
  try {
    const store = await ensurePlumbCredentialStore();
    await store.removeCredentials(OCI_PROVIDER_ID);
  } catch {
    // Best-effort -- safe config removal above is the primary guarantee.
  }
}

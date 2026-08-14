/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export type CloudConfigFieldType =
  | 'text'
  | 'secret'
  | 'select'
  | 'optional_text'
  | 'path_reference'
  | 'region'
  | 'project'
  | 'compartment'
  | 'profile'
  | 'endpoint'
  | 'account'
  | 'space';

export interface CloudConfigFieldOption {
  readonly value: string;
  readonly label: string;
}

export interface CloudConfigFieldDef {
  /** Safe-config key (PlumbSecureCredentialStore.cloudConfig), or 'credential' for the one secret field. */
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly type: CloudConfigFieldType;
  readonly required: boolean;
  readonly secret?: boolean;
  readonly options?: readonly CloudConfigFieldOption[];
  /** The env var this field falls back to when no PLUMB override is set (for source-provenance display). */
  readonly envVar?: string;
}

export interface CloudAuthModeDef {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly fields: readonly CloudConfigFieldDef[];
}

export interface CloudProviderConfigSchema {
  readonly providerId: string;
  readonly authModeField: CloudConfigFieldDef & {
    readonly options: readonly CloudConfigFieldOption[];
  };
  readonly authModes: readonly CloudAuthModeDef[];
}

export type CloudConfigFormValues = {
  authMode: string;
  hasExistingCredential?: boolean;
} & Record<string, string | boolean | undefined>;

export type CloudConfigValidationErrors = Record<string, string>;

/** The single source of truth for which fields are visible for a given auth mode -- generic providers have no further conditional visibility beyond the auth-mode selection itself. */
export function getVisibleCloudFields(
  schema: CloudProviderConfigSchema,
  authMode: string,
): CloudConfigFieldDef[] {
  const mode = schema.authModes.find((m) => m.id === authMode);
  return mode ? [...mode.fields] : [];
}

/**
 * Generic validation: the auth mode must be one of the schema's modes,
 * every required non-secret field in the visible set must be non-blank,
 * and a required secret field must have either a newly-entered value or
 * an existing credential (edit mode). Select-kind fields (e.g. a
 * provider-specific subtype) are required exactly like any other field.
 */
export function validateCloudConfig(
  schema: CloudProviderConfigSchema,
  values: CloudConfigFormValues,
): CloudConfigValidationErrors {
  const errors: CloudConfigValidationErrors = {};
  if (!schema.authModes.some((m) => m.id === values.authMode)) {
    errors['authMode'] = 'Select an authentication method.';
    return errors;
  }
  for (const field of getVisibleCloudFields(schema, values.authMode)) {
    if (field.id === 'authMode') continue;
    const raw = values[field.id];
    if (field.secret) {
      const hasNew = typeof raw === 'string' && raw.trim().length > 0;
      if (field.required && !hasNew && !values.hasExistingCredential) {
        errors[field.id] = `${field.label} is required.`;
      }
      continue;
    }
    if (field.type === 'select') {
      if (field.required && !raw) {
        errors[field.id] = `Select a ${field.label.toLowerCase()}.`;
      }
      continue;
    }
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (field.required && !trimmed) {
      errors[field.id] = `${field.label} is required.`;
    }
  }
  return errors;
}

/**
 * Splits form values into the safe (non-secret) config to persist via
 * saveProviderCloudConfig, and the secret (if any) to persist via the
 * credential store. `authMode` and every visible non-secret field's
 * trimmed value are written into the safe config (including required
 * select fields, e.g. an IAM/scope subtype) so edit-mode reload and
 * source-provenance display have something to read back.
 */
export function buildCloudSaveOperation(
  schema: CloudProviderConfigSchema,
  values: CloudConfigFormValues,
): { safeConfig: Record<string, string>; credential?: string } {
  const safeConfig: Record<string, string> = { authMode: values.authMode };
  let credential: string | undefined;
  for (const field of getVisibleCloudFields(schema, values.authMode)) {
    if (field.id === 'authMode') continue;
    const raw = values[field.id];
    if (field.secret) {
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (trimmed) credential = trimmed;
      continue;
    }
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (trimmed) safeConfig[field.id] = trimmed;
  }
  return { safeConfig, ...(credential ? { credential } : {}) };
}

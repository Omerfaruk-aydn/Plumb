/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * OCI Generative AI provider configuration domain schema: the typed field
 * definitions, conditional visibility, and canonical validation for
 * PLUMB's in-app OCI setup UX. This is intentionally the ONLY place OCI's
 * configuration rules live -- the Ink UI (packages/cli) renders these
 * field definitions and displays validation results; it must never
 * reimplement "if provider === 'oci' && authMode === ..." logic itself,
 * or the UI and this module can drift.
 *
 * Reference implementation for the other four cloud providers' schemas
 * (Bedrock/Azure/Vertex/watsonx), which follow the same
 * CloudConfigFieldDef/CloudAuthModeDef/CloudProviderConfigSchema shape.
 */

export type {
  CloudConfigFieldType,
  CloudConfigFieldOption,
  CloudConfigFieldDef,
  CloudAuthModeDef,
  CloudProviderConfigSchema,
} from './cloudConfigSchema.js';
import type {
  CloudConfigFieldDef,
  CloudProviderConfigSchema,
} from './cloudConfigSchema.js';

const OCI_CLOUD_CONTEXT_FIELDS: readonly CloudConfigFieldDef[] = [
  {
    id: 'region',
    label: 'Region',
    type: 'region',
    required: true,
    envVar: 'OCI_REGION',
    description: 'e.g. us-chicago-1',
  },
  {
    id: 'projectId',
    label: 'Project OCID',
    type: 'project',
    required: true,
    envVar: 'OCI_GENAI_PROJECT_ID',
    description:
      'The OCI Generative AI project OCID -- required by every OpenAI-compatible request.',
  },
  {
    id: 'compartmentId',
    label: 'Compartment OCID',
    type: 'compartment',
    required: false,
    envVar: 'OCI_COMPARTMENT_ID',
    description: 'Optional -- the compartment billed/authorized for requests.',
  },
];

export const OCI_GENAI_CONFIG_SCHEMA: CloudProviderConfigSchema = {
  providerId: 'oci-genai',
  authModeField: {
    id: 'authMode',
    label: 'Authentication',
    type: 'select',
    required: true,
    options: [
      { value: 'api_key', label: 'Generative AI API Key' },
      { value: 'iam', label: 'OCI IAM' },
    ],
  },
  authModes: [
    {
      id: 'api_key',
      label: 'Generative AI API Key',
      description:
        'A simple bearer-token credential. Oracle: "Use API keys for testing and early development."',
      fields: [
        ...OCI_CLOUD_CONTEXT_FIELDS,
        {
          id: 'credential',
          label: 'API Key',
          type: 'secret',
          required: true,
          secret: true,
        },
      ],
    },
    {
      id: 'iam',
      label: 'OCI IAM',
      description:
        'Official oci-common request signing. Oracle: "Use IAM-based authentication for production workloads and OCI-managed environments."',
      fields: [
        {
          id: 'iamAuthMode',
          label: 'IAM Subtype',
          type: 'select',
          required: true,
          options: [
            { value: 'config_profile', label: 'Config Profile' },
            { value: 'session', label: 'Session' },
            { value: 'instance_principal', label: 'Instance Principal' },
            { value: 'resource_principal', label: 'Resource Principal' },
          ],
        },
        // config_profile / session only:
        {
          id: 'iamConfigPath',
          label: 'Config File Path',
          type: 'path_reference',
          required: false,
          envVar: 'OCI_IAM_CONFIG_PATH',
          description: 'Optional -- defaults to ~/.oci/config.',
        },
        {
          id: 'iamConfigProfile',
          label: 'Profile',
          type: 'profile',
          required: false,
          envVar: 'OCI_IAM_CONFIG_PROFILE',
          description: 'Optional -- defaults to the DEFAULT profile.',
        },
        ...OCI_CLOUD_CONTEXT_FIELDS,
      ],
    },
  ],
};

/**
 * Which IAM subtypes actually use `iamConfigPath`/`iamConfigProfile` --
 * instance_principal/resource_principal read their identity entirely from
 * the OCI compute/function runtime and must never prompt for a local
 * config reference (the official credential authority owns them).
 */
const IAM_SUBTYPES_WITH_CONFIG_REFERENCE: ReadonlySet<string> = new Set([
  'config_profile',
  'session',
]);

/**
 * Resolves the exact visible field list for a given (authMode, iamAuthMode)
 * selection -- the single source of truth the Ink UI must render from,
 * never a parallel "if authMode === X" branch of its own.
 */
export function getVisibleOciFields(
  authMode: 'api_key' | 'iam',
  iamAuthMode?: string,
): CloudConfigFieldDef[] {
  const mode = OCI_GENAI_CONFIG_SCHEMA.authModes.find((m) => m.id === authMode);
  if (!mode) return [];
  if (authMode === 'api_key') return [...mode.fields];
  // authMode === 'iam'
  return mode.fields.filter((f) => {
    if (f.id === 'iamConfigPath' || f.id === 'iamConfigProfile') {
      return iamAuthMode
        ? IAM_SUBTYPES_WITH_CONFIG_REFERENCE.has(iamAuthMode)
        : false;
    }
    return true;
  });
}

export interface OciConfigFormValues {
  authMode: 'api_key' | 'iam' | '';
  iamAuthMode?: string;
  region?: string;
  projectId?: string;
  compartmentId?: string;
  iamConfigPath?: string;
  iamConfigProfile?: string;
  /** Set only when the user is entering/replacing the secret in this form submission. Blank means "preserve existing". */
  credential?: string;
  /** Whether a credential is already configured (edit mode) -- required for API-key mode validation when `credential` is blank. */
  hasExistingCredential?: boolean;
}

export type OciConfigValidationErrors = Partial<
  Record<
    | 'authMode'
    | 'iamAuthMode'
    | 'region'
    | 'projectId'
    | 'compartmentId'
    | 'iamConfigPath'
    | 'iamConfigProfile'
    | 'credential',
    string
  >
>;

const OCID_PATTERN = /^ocid1\.[a-z0-9]+\.[a-z0-9-]*\.[a-z0-9-]*\.[a-z0-9-_]+$/i;

/**
 * Structural sanity check, not a brittle exact-format regex -- OCI's OCID
 * scheme (ocid1.<resource-type>.<realm>.<region>.<unique-id>) has evolved
 * before and may again; this rejects "not remotely OCID-shaped" input
 * without hardcoding assumptions likely to reject a future valid format.
 */
function looksLikeOcid(value: string): boolean {
  return OCID_PATTERN.test(value.trim());
}

/**
 * Canonical OCI configuration validator. React (packages/cli) must call
 * this and display the returned errors -- it must never reimplement any
 * of these rules itself.
 */
export function validateOciConfig(
  values: OciConfigFormValues,
): OciConfigValidationErrors {
  const errors: OciConfigValidationErrors = {};

  if (values.authMode !== 'api_key' && values.authMode !== 'iam') {
    errors.authMode = 'Select an authentication method.';
    return errors;
  }

  if (!values.region?.trim()) {
    errors.region = 'Region is required.';
  }

  if (!values.projectId?.trim()) {
    errors.projectId = 'Project OCID is required.';
  } else if (!looksLikeOcid(values.projectId)) {
    errors.projectId = 'Does not look like a valid OCID.';
  }

  if (values.compartmentId?.trim() && !looksLikeOcid(values.compartmentId)) {
    errors.compartmentId = 'Does not look like a valid OCID.';
  }

  if (values.authMode === 'api_key') {
    const hasNewCredential = !!values.credential?.trim();
    if (!hasNewCredential && !values.hasExistingCredential) {
      errors.credential = 'API key is required.';
    }
    return errors;
  }

  // authMode === 'iam'
  const validIamModes = new Set([
    'config_profile',
    'session',
    'instance_principal',
    'resource_principal',
  ]);
  if (!values.iamAuthMode || !validIamModes.has(values.iamAuthMode)) {
    errors.iamAuthMode = 'Select an IAM subtype.';
  }
  // config_profile/session/instance_principal/resource_principal all have
  // no further required fields beyond region/project (config path/profile
  // are optional -- oci-common falls back to ~/.oci/config's DEFAULT
  // profile when unset).

  return errors;
}

/**
 * Splits form values into the safe (non-secret) config object to persist
 * via saveProviderCloudConfig, and the secret (if any) to persist via the
 * credential store. Never puts the credential in the safe object, even if
 * the form submitted both together.
 */
export function buildOciSaveOperation(values: OciConfigFormValues): {
  safeConfig: Record<string, string>;
  credential?: string;
} {
  const safeConfig: Record<string, string> = {
    region: values.region?.trim() ?? '',
    projectId: values.projectId?.trim() ?? '',
  };
  if (values.compartmentId?.trim()) {
    safeConfig['compartmentId'] = values.compartmentId.trim();
  }
  if (values.authMode === 'iam') {
    safeConfig['iamAuthMode'] = values.iamAuthMode ?? '';
    if (
      values.iamAuthMode &&
      IAM_SUBTYPES_WITH_CONFIG_REFERENCE.has(values.iamAuthMode)
    ) {
      if (values.iamConfigPath?.trim()) {
        safeConfig['iamConfigPath'] = values.iamConfigPath.trim();
      }
      if (values.iamConfigProfile?.trim()) {
        safeConfig['iamConfigProfile'] = values.iamConfigProfile.trim();
      }
    }
  }
  const hasNewCredential = !!values.credential?.trim();
  return {
    safeConfig,
    ...(hasNewCredential ? { credential: values.credential!.trim() } : {}),
  };
}

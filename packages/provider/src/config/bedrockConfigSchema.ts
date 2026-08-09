/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Amazon Bedrock configuration domain schema. Bedrock delegates credential
 * *resolution* entirely to the AWS SDK's own default credential chain (env
 * vars, shared config/credentials files, ECS/EC2/IRSA, SSO) -- PLUMB never
 * stores an AWS secret access key itself. What PLUMB's in-app setup UX
 * actually needs to capture is: which chain mode to use, an optional named
 * profile, and the region (Bedrock's `ListFoundationModels`/runtime APIs
 * are region-scoped, unlike a single global endpoint).
 */
import type { CloudProviderConfigSchema } from './cloudConfigSchema.js';
import {
  getVisibleCloudFields,
  validateCloudConfig,
  buildCloudSaveOperation,
  type CloudConfigFormValues,
  type CloudConfigValidationErrors,
} from './cloudConfigSchema.js';

const REGION_FIELD = {
  id: 'region',
  label: 'Region',
  type: 'region',
  required: true,
  envVar: 'AWS_REGION',
  description: 'e.g. us-east-1',
} as const;

export const BEDROCK_CONFIG_SCHEMA: CloudProviderConfigSchema = {
  providerId: 'amazon-bedrock',
  authModeField: {
    id: 'authMode',
    label: 'Authentication',
    type: 'select',
    required: true,
    options: [
      { value: 'default_chain', label: 'AWS Default Credential Chain' },
      { value: 'profile', label: 'AWS Profile' },
    ],
  },
  authModes: [
    {
      id: 'default_chain',
      label: 'AWS Default Credential Chain',
      description:
        'Resolves credentials the same way the AWS CLI/SDK does: environment variables, shared config, ECS/EC2 instance role, or IRSA -- whichever is present. PLUMB never stores an AWS secret key for this mode.',
      fields: [REGION_FIELD],
    },
    {
      id: 'profile',
      label: 'AWS Profile',
      description:
        "A named profile from ~/.aws/credentials or ~/.aws/config. PLUMB stores only the profile name, never the profile's underlying secret.",
      fields: [
        {
          id: 'profileName',
          label: 'Profile Name',
          type: 'profile',
          required: true,
          envVar: 'AWS_PROFILE',
          description: 'e.g. bedrock-prod',
        },
        REGION_FIELD,
      ],
    },
  ],
};

export function getVisibleBedrockFields(authMode: string) {
  return getVisibleCloudFields(BEDROCK_CONFIG_SCHEMA, authMode);
}

export function validateBedrockConfig(
  values: CloudConfigFormValues,
): CloudConfigValidationErrors {
  return validateCloudConfig(BEDROCK_CONFIG_SCHEMA, values);
}

export function buildBedrockSaveOperation(values: CloudConfigFormValues): {
  safeConfig: Record<string, string>;
  credential?: string;
} {
  return buildCloudSaveOperation(BEDROCK_CONFIG_SCHEMA, values);
}

/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * IBM watsonx.ai configuration domain schema. watsonx has a single
 * credential shape (an IBM Cloud IAM API key, resolved through
 * PlumbSecureCredentialStore exactly like OCI's api_key mode) but requires
 * choosing exactly one of two mutually-exclusive scopes -- Project or
 * Space (packages/provider/src/transports/watsonx.ts's
 * resolveWatsonxContext() already enforces "projectId wins if both are
 * somehow set"; this schema prevents that ambiguity from ever being
 * constructed in the first place by treating scope as the auth-mode
 * selector, so only one of projectId/spaceId is ever visible/saved).
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
  envVar: 'WATSONX_REGION',
  description: 'e.g. us-south, eu-de, eu-gb, jp-tok, au-syd',
} as const;

const CREDENTIAL_FIELD = {
  id: 'credential',
  label: 'API Key',
  type: 'secret',
  required: true,
  secret: true,
} as const;

export const WATSONX_CONFIG_SCHEMA: CloudProviderConfigSchema = {
  providerId: 'watsonx',
  authModeField: {
    id: 'authMode',
    label: 'Scope',
    type: 'select',
    required: true,
    options: [
      { value: 'project', label: 'Project' },
      { value: 'space', label: 'Space (deployment space)' },
    ],
  },
  authModes: [
    {
      id: 'project',
      label: 'Project',
      description: 'Run against a watsonx.ai project.',
      fields: [
        {
          id: 'projectId',
          label: 'Project ID',
          type: 'project',
          required: true,
          envVar: 'WATSONX_PROJECT_ID',
        },
        REGION_FIELD,
        CREDENTIAL_FIELD,
      ],
    },
    {
      id: 'space',
      label: 'Space',
      description: 'Run against a watsonx.ai deployment space.',
      fields: [
        {
          id: 'spaceId',
          label: 'Space ID',
          type: 'account',
          required: true,
          envVar: 'WATSONX_SPACE_ID',
        },
        REGION_FIELD,
        CREDENTIAL_FIELD,
      ],
    },
  ],
};

export function getVisibleWatsonxFields(authMode: string) {
  return getVisibleCloudFields(WATSONX_CONFIG_SCHEMA, authMode);
}

export function validateWatsonxConfig(
  values: CloudConfigFormValues,
): CloudConfigValidationErrors {
  return validateCloudConfig(WATSONX_CONFIG_SCHEMA, values);
}

export function buildWatsonxSaveOperation(values: CloudConfigFormValues): {
  safeConfig: Record<string, string>;
  credential?: string;
} {
  return buildCloudSaveOperation(WATSONX_CONFIG_SCHEMA, values);
}

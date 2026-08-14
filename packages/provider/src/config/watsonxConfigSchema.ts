/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
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

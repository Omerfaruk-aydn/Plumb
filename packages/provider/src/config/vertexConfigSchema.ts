/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Google Vertex AI configuration domain schema. Mirrors the two auth paths
 * the real transport (packages/provider/src/omp-ai/registry/google-vertex.ts)
 * already supports: a simple API key, or Application Default Credentials
 * (the official Google credential authority -- gcloud ADC file or
 * GOOGLE_APPLICATION_CREDENTIALS), which additionally require project +
 * location since Vertex has no single global endpoint.
 */
import type { CloudProviderConfigSchema } from './cloudConfigSchema.js';
import {
  getVisibleCloudFields,
  validateCloudConfig,
  buildCloudSaveOperation,
  type CloudConfigFormValues,
  type CloudConfigValidationErrors,
} from './cloudConfigSchema.js';

const PROJECT_FIELD = {
  id: 'project',
  label: 'Project',
  type: 'project',
  required: true,
  envVar: 'GOOGLE_CLOUD_PROJECT',
  description: 'Your GCP project ID.',
} as const;

const LOCATION_FIELD = {
  id: 'location',
  label: 'Location',
  type: 'region',
  required: true,
  envVar: 'GOOGLE_VERTEX_LOCATION',
  description: 'e.g. us-central1',
} as const;

export const VERTEX_CONFIG_SCHEMA: CloudProviderConfigSchema = {
  providerId: 'google-vertex',
  authModeField: {
    id: 'authMode',
    label: 'Authentication',
    type: 'select',
    required: true,
    options: [
      {
        value: 'adc',
        label: 'Application Default Credentials (recommended)',
      },
      { value: 'api_key', label: 'API Key' },
    ],
  },
  authModes: [
    {
      id: 'adc',
      label: 'Application Default Credentials',
      description:
        "The official Google credential authority: gcloud's ADC file, or GOOGLE_APPLICATION_CREDENTIALS. PLUMB never stores a Google service-account key itself.",
      fields: [PROJECT_FIELD, LOCATION_FIELD],
    },
    {
      id: 'api_key',
      label: 'API Key',
      description: 'A Vertex AI Studio API key.',
      fields: [
        PROJECT_FIELD,
        LOCATION_FIELD,
        {
          id: 'credential',
          label: 'API Key',
          type: 'secret',
          required: true,
          secret: true,
        },
      ],
    },
  ],
};

export function getVisibleVertexFields(authMode: string) {
  return getVisibleCloudFields(VERTEX_CONFIG_SCHEMA, authMode);
}

export function validateVertexConfig(
  values: CloudConfigFormValues,
): CloudConfigValidationErrors {
  return validateCloudConfig(VERTEX_CONFIG_SCHEMA, values);
}

export function buildVertexSaveOperation(values: CloudConfigFormValues): {
  safeConfig: Record<string, string>;
  credential?: string;
} {
  return buildCloudSaveOperation(VERTEX_CONFIG_SCHEMA, values);
}

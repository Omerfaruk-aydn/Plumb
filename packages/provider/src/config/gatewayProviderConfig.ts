/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  validateCloudConfig,
  type CloudConfigFormValues,
  type CloudConfigValidationErrors,
  type CloudProviderConfigSchema,
} from './cloudConfigSchema.js';
import { validateLocalProviderBaseUrl } from './localProviderConfig.js';
import { resolveProviderConfigValue } from './providerConfigResolver.js';

export const GATEWAY_CONFIG_PROVIDER_IDS = ['portkey', 'litellm'] as const;
export type GatewayConfigProviderId =
  (typeof GATEWAY_CONFIG_PROVIDER_IDS)[number];

const ENDPOINTS: Readonly<
  Record<
    GatewayConfigProviderId,
    { defaultBaseUrl: string; envVar: string; credentialEnvVar: string }
  >
> = {
  portkey: {
    defaultBaseUrl: 'https://api.portkey.ai/v1',
    envVar: 'PORTKEY_BASE_URL',
    credentialEnvVar: 'PORTKEY_API_KEY',
  },
  litellm: {
    defaultBaseUrl: 'http://127.0.0.1:4000/v1',
    envVar: 'LITELLM_BASE_URL',
    credentialEnvVar: 'LITELLM_API_KEY',
  },
};

export function isGatewayConfigProviderId(
  providerId: string,
): providerId is GatewayConfigProviderId {
  return Object.prototype.hasOwnProperty.call(ENDPOINTS, providerId);
}

export function resolveGatewayProviderBaseUrl(
  providerId: string,
): string | undefined {
  if (!isGatewayConfigProviderId(providerId)) return undefined;
  const definition = ENDPOINTS[providerId];
  return resolveProviderConfigValue(
    providerId,
    'baseUrl',
    definition.envVar,
    definition.defaultBaseUrl,
  )?.replace(/\/+$/, '');
}

function baseUrlField(providerId: GatewayConfigProviderId) {
  const definition = ENDPOINTS[providerId];
  return {
    id: 'baseUrl',
    label: 'Gateway API base URL',
    description: 'Include the OpenAI-compatible API prefix, normally /v1.',
    type: 'endpoint' as const,
    required: true,
    envVar: definition.envVar,
  };
}

function credentialField(providerId: GatewayConfigProviderId) {
  const definition = ENDPOINTS[providerId];
  return {
    id: 'credential',
    label: providerId === 'portkey' ? 'Portkey API key' : 'Proxy API key',
    description: 'Stored in the OS credential store, never safe config.',
    type: 'secret' as const,
    required: true,
    secret: true,
    envVar: definition.credentialEnvVar,
  };
}

export function getGatewayProviderConfigSchema(
  providerId: string,
): CloudProviderConfigSchema | undefined {
  if (!isGatewayConfigProviderId(providerId)) return undefined;
  const endpoint = baseUrlField(providerId);
  const credential = credentialField(providerId);
  if (providerId === 'litellm') {
    return {
      providerId,
      authModeField: {
        id: 'authMode',
        label: 'Authentication',
        type: 'select',
        required: true,
        options: [
          { value: 'none', label: 'No authentication' },
          { value: 'bearer', label: 'Bearer token' },
        ],
      },
      authModes: [
        { id: 'none', label: 'No authentication', fields: [endpoint] },
        {
          id: 'bearer',
          label: 'Bearer token',
          fields: [endpoint, credential],
        },
      ],
    };
  }

  return {
    providerId,
    authModeField: {
      id: 'authMode',
      label: 'Portkey routing',
      type: 'select',
      required: true,
      options: [
        { value: 'model-id', label: 'Provider in model ID' },
        { value: 'provider', label: 'Provider header' },
        { value: 'config', label: 'Config header' },
      ],
    },
    authModes: [
      {
        id: 'model-id',
        label: 'Provider in model ID',
        fields: [endpoint, credential],
      },
      {
        id: 'provider',
        label: 'Provider header',
        fields: [
          endpoint,
          {
            id: 'routingValue',
            label: 'Portkey provider slug',
            description: 'Sent as x-portkey-provider.',
            type: 'text',
            required: true,
          },
          credential,
        ],
      },
      {
        id: 'config',
        label: 'Config header',
        fields: [
          endpoint,
          {
            id: 'routingValue',
            label: 'Portkey config ID',
            description: 'Sent as x-portkey-config.',
            type: 'text',
            required: true,
          },
          credential,
        ],
      },
    ],
  };
}

export function validateGatewayProviderConfig(
  providerId: string,
  values: CloudConfigFormValues,
): CloudConfigValidationErrors {
  const schema = getGatewayProviderConfigSchema(providerId);
  if (!schema) return { providerId: 'Unknown gateway provider.' };
  const errors = validateCloudConfig(schema, values);
  const baseUrl = values['baseUrl'];
  if (typeof baseUrl === 'string' && baseUrl.trim()) {
    const endpointError = validateLocalProviderBaseUrl(baseUrl);
    if (endpointError) errors['baseUrl'] = endpointError;
  }
  const routingValue = values['routingValue'];
  if (
    providerId === 'portkey' &&
    typeof routingValue === 'string' &&
    /[\r\n]/.test(routingValue)
  ) {
    errors['routingValue'] = 'Routing values must not contain line breaks.';
  }
  return errors;
}

export function buildGatewayProviderSaveOperation(
  providerId: string,
  values: CloudConfigFormValues,
): { safeConfig: Record<string, string>; credential?: string } {
  if (!isGatewayConfigProviderId(providerId)) return { safeConfig: {} };
  const authMode = String(values['authMode'] ?? '').trim();
  const safeConfig: Record<string, string> = {
    authMode,
    baseUrl: String(values['baseUrl'] ?? '')
      .trim()
      .replace(/\/+$/, ''),
  };
  const routingValue = String(values['routingValue'] ?? '').trim();
  if (providerId === 'portkey') {
    safeConfig['routingMode'] = authMode;
    if (authMode === 'provider' && routingValue) {
      safeConfig['portkeyProvider'] = routingValue;
    } else if (authMode === 'config' && routingValue) {
      safeConfig['portkeyConfig'] = routingValue;
    }
  }
  const credential = String(values['credential'] ?? '').trim();
  return {
    safeConfig,
    ...(credential ? { credential } : undefined),
  };
}

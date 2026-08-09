/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical endpoint metadata for PLUMB's five local runtimes.
 *
 * The values here are OpenAI-compatible API base URLs (including `/v1`).
 * Ollama is the one exception during discovery: its authoritative local model
 * inventory is the native `/api/tags` endpoint, so discovery derives the
 * native server root while production chat continues to use `/v1`.
 */

import type { PlumbKnownApi } from '../types.js';
import {
  buildCloudSaveOperation,
  validateCloudConfig,
  type CloudConfigFormValues,
  type CloudConfigValidationErrors,
  type CloudProviderConfigSchema,
} from './cloudConfigSchema.js';
import { resolveProviderConfigValue } from './providerConfigResolver.js';

export const LOCAL_PROVIDER_IDS = [
  'ollama',
  'lm-studio',
  'llama-cpp',
  'vllm',
  'sglang',
] as const;

export type LocalProviderId = (typeof LOCAL_PROVIDER_IDS)[number];

export interface LocalProviderEndpointDefinition {
  readonly providerId: LocalProviderId;
  readonly defaultBaseUrl: string;
  readonly envVar: string;
  readonly api: PlumbKnownApi;
}

const DEFINITIONS: Readonly<
  Record<LocalProviderId, LocalProviderEndpointDefinition>
> = {
  ollama: {
    providerId: 'ollama',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    envVar: 'OLLAMA_BASE_URL',
    api: 'ollama-chat',
  },
  'lm-studio': {
    providerId: 'lm-studio',
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    envVar: 'LM_STUDIO_BASE_URL',
    api: 'openai-completions',
  },
  'llama-cpp': {
    providerId: 'llama-cpp',
    defaultBaseUrl: 'http://127.0.0.1:8080/v1',
    envVar: 'LLAMA_CPP_BASE_URL',
    api: 'openai-completions',
  },
  vllm: {
    providerId: 'vllm',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    envVar: 'VLLM_BASE_URL',
    api: 'openai-completions',
  },
  sglang: {
    providerId: 'sglang',
    defaultBaseUrl: 'http://127.0.0.1:30000/v1',
    envVar: 'SGLANG_BASE_URL',
    api: 'openai-completions',
  },
};

export function isLocalProviderId(
  providerId: string,
): providerId is LocalProviderId {
  return Object.prototype.hasOwnProperty.call(DEFINITIONS, providerId);
}

export function getLocalProviderEndpointDefinition(
  providerId: string,
): LocalProviderEndpointDefinition | undefined {
  return isLocalProviderId(providerId) ? DEFINITIONS[providerId] : undefined;
}

/**
 * Resolve the production OpenAI-compatible base URL using the normal PLUMB
 * precedence: persisted in-app value > environment > official local default.
 */
export function resolveLocalProviderBaseUrl(
  providerId: string,
): string | undefined {
  const definition = getLocalProviderEndpointDefinition(providerId);
  if (!definition) return undefined;
  const resolved = resolveProviderConfigValue(
    providerId,
    'baseUrl',
    definition.envVar,
    definition.defaultBaseUrl,
  );
  const normalized = resolved?.replace(/\/+$/, '');
  if (!normalized) return undefined;
  if (providerId === 'ollama') {
    return `${normalized.replace(/\/v1$/i, '')}/v1`;
  }
  return normalized;
}

/** Ollama native discovery uses `{root}/api/tags`, not `{root}/v1/models`. */
export function resolveOllamaNativeBaseUrl(): string {
  const apiBase =
    resolveLocalProviderBaseUrl('ollama') ?? DEFINITIONS.ollama.defaultBaseUrl;
  return apiBase.replace(/\/v1$/i, '');
}

export function validateLocalProviderBaseUrl(
  baseUrl: string,
): string | undefined {
  const trimmed = baseUrl.trim();
  if (!trimmed) return 'Base URL is required.';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return 'Enter a valid absolute URL.';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Base URL must use http:// or https://.';
  }
  if (parsed.username || parsed.password) {
    return 'Do not embed credentials in the Base URL.';
  }
  if (parsed.search || parsed.hash) {
    return 'Base URL must not include a query string or fragment.';
  }
  return undefined;
}

export function getLocalProviderConfigSchema(
  providerId: string,
): CloudProviderConfigSchema | undefined {
  const definition = getLocalProviderEndpointDefinition(providerId);
  if (!definition) return undefined;
  const baseUrlField = {
    id: 'baseUrl',
    label: 'OpenAI-compatible base URL',
    description:
      providerId === 'ollama'
        ? 'Ollama server root or /v1 API base (PLUMB normalizes it to /v1).'
        : 'Include the API prefix, normally /v1.',
    type: 'endpoint' as const,
    required: true,
    envVar: definition.envVar,
  };
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
      {
        id: 'none',
        label: 'No authentication',
        fields: [baseUrlField],
      },
      {
        id: 'bearer',
        label: 'Bearer token',
        fields: [
          baseUrlField,
          {
            id: 'credential',
            label: 'Bearer token',
            description:
              'Stored in the OS credential store, never safe config.',
            type: 'secret',
            required: true,
            secret: true,
          },
        ],
      },
    ],
  };
}

export function validateLocalProviderConfig(
  providerId: string,
  values: CloudConfigFormValues,
): CloudConfigValidationErrors {
  const schema = getLocalProviderConfigSchema(providerId);
  if (!schema) return { providerId: 'Unknown local provider.' };
  const errors = validateCloudConfig(schema, values);
  const raw = values['baseUrl'];
  if (typeof raw === 'string' && raw.trim()) {
    const endpointError = validateLocalProviderBaseUrl(raw);
    if (endpointError) errors['baseUrl'] = endpointError;
  }
  return errors;
}

export function buildLocalProviderSaveOperation(
  providerId: string,
  values: CloudConfigFormValues,
): { safeConfig: Record<string, string>; credential?: string } {
  const schema = getLocalProviderConfigSchema(providerId);
  if (!schema) return { safeConfig: {} };
  const result = buildCloudSaveOperation(schema, values);
  if (result.safeConfig['baseUrl']) {
    result.safeConfig['baseUrl'] = result.safeConfig['baseUrl'].replace(
      /\/+$/,
      '',
    );
  }
  return result;
}

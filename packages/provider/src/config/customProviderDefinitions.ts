/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import {
  PlumbProviderCategory,
  type PlumbKnownApi,
  type PlumbModel,
  type PlumbProvider,
} from '../types.js';
import { validateLocalProviderBaseUrl } from './localProviderConfig.js';

export const CUSTOM_PROVIDER_DEFINITION_VERSION = 1 as const;

export type CustomProviderDialect =
  | 'openai-completions'
  | 'anthropic-messages'
  | 'google-generative-ai';

export type CustomCredentialPlacement =
  | 'none'
  | 'bearer'
  | 'x-api-key'
  | 'api-key'
  | 'query-key';

export interface CustomProviderManualModel {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly reasoning?: boolean;
  readonly toolsSupported?: boolean;
  readonly input?: PlumbModel['input'];
}

export interface CustomProviderDefinition {
  readonly version: typeof CUSTOM_PROVIDER_DEFINITION_VERSION;
  readonly id: string;
  readonly displayName: string;
  readonly dialect: CustomProviderDialect;
  readonly baseUrl: string;
  readonly credentialPlacement: CustomCredentialPlacement;
  readonly safeHeaders: Readonly<Record<string, string>>;
  readonly manualModels: readonly CustomProviderManualModel[];
}

export interface CustomProviderDefinitionInput {
  readonly id?: string;
  readonly displayName: string;
  readonly dialect: CustomProviderDialect;
  readonly baseUrl: string;
  readonly credentialPlacement?: CustomCredentialPlacement;
  readonly safeHeaders?: Readonly<Record<string, string>>;
  readonly manualModels?: readonly CustomProviderManualModel[];
}

export type CustomProviderValidationErrors = Record<string, string>;

const DEFINITIONS = new Map<string, CustomProviderDefinition>();
const CUSTOM_ID_PATTERN =
  /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESERVED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-goog-api-key',
  'cf-aig-authorization',
  'x-portkey-api-key',
  'cookie',
  'set-cookie',
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'keep-alive',
]);

const DIALECTS = new Set<CustomProviderDialect>([
  'openai-completions',
  'anthropic-messages',
  'google-generative-ai',
]);
const PLACEMENTS = new Set<CustomCredentialPlacement>([
  'none',
  'bearer',
  'x-api-key',
  'api-key',
  'query-key',
]);

function defaultCredentialPlacement(
  dialect: CustomProviderDialect,
): CustomCredentialPlacement {
  if (dialect === 'anthropic-messages') return 'x-api-key';
  if (dialect === 'google-generative-ai') return 'query-key';
  return 'bearer';
}

export function createCustomProviderId(): string {
  return `custom:${randomUUID()}`;
}

/**
 * Every header name that can carry a credential on PLUMB's wire. A custom
 * provider clears all of them before applying its own, so no definition can
 * ever inherit another provider's authority -- this is the single list both
 * the production transport and discovery consult.
 */
export const CUSTOM_CREDENTIAL_HEADER_NAMES: readonly string[] = [
  'Authorization',
  'Proxy-Authorization',
  'x-api-key',
  'api-key',
  'x-goog-api-key',
  'cf-aig-authorization',
  'x-portkey-api-key',
];

/**
 * The one header a given placement puts on the wire, or undefined when the
 * credential does not travel in a header (`none`, `query-key`, or no key).
 */
export function resolveCustomCredentialHeader(
  placement: CustomCredentialPlacement,
  apiKey: string | undefined,
): { name: string; value: string } | undefined {
  if (!apiKey) return undefined;
  switch (placement) {
    case 'bearer':
      return { name: 'Authorization', value: `Bearer ${apiKey}` };
    case 'x-api-key':
      return { name: 'x-api-key', value: apiKey };
    case 'api-key':
      return { name: 'api-key', value: apiKey };
    default:
      return undefined;
  }
}

/**
 * Full request headers for a custom provider: its safe headers, then its own
 * credential applied last so a safe header can never shadow or replace the
 * credential authority.
 */
export function buildCustomProviderHeaders(
  definition: CustomProviderDefinition,
  apiKey: string | undefined,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    ...definition.safeHeaders,
    ...extra,
  };
  for (const name of CUSTOM_CREDENTIAL_HEADER_NAMES) {
    for (const present of Object.keys(headers)) {
      if (present.toLowerCase() === name.toLowerCase()) delete headers[present];
    }
  }
  const credential = resolveCustomCredentialHeader(
    definition.credentialPlacement,
    apiKey,
  );
  if (credential) headers[credential.name] = credential.value;
  return headers;
}

export function isCustomProviderId(providerId: string): boolean {
  return CUSTOM_ID_PATTERN.test(providerId);
}

export function validateCustomProviderDefinition(
  input: CustomProviderDefinitionInput,
): CustomProviderValidationErrors {
  const errors: CustomProviderValidationErrors = {};
  if (input.id && !isCustomProviderId(input.id)) {
    errors['id'] = 'Custom provider IDs must use the custom:<uuid> format.';
  }
  if (!input.displayName.trim()) errors['displayName'] = 'Name is required.';
  if (!DIALECTS.has(input.dialect)) errors['dialect'] = 'Unsupported dialect.';
  const endpointError = validateLocalProviderBaseUrl(input.baseUrl);
  if (endpointError) errors['baseUrl'] = endpointError;
  const placement =
    input.credentialPlacement ?? defaultCredentialPlacement(input.dialect);
  if (!PLACEMENTS.has(placement)) {
    errors['credentialPlacement'] = 'Unsupported credential placement.';
  }
  if (input.dialect !== 'google-generative-ai' && placement === 'query-key') {
    errors['credentialPlacement'] =
      'Query-key authentication is only supported by the Gemini-compatible dialect.';
  }

  for (const [name, value] of Object.entries(input.safeHeaders ?? {})) {
    const normalized = name.trim().toLowerCase();
    if (!HEADER_NAME_PATTERN.test(name.trim())) {
      errors[`header:${name}`] = 'Header name is invalid.';
    } else if (RESERVED_HEADERS.has(normalized)) {
      errors[`header:${name}`] =
        'Authentication, sensitive, and hop-by-hop headers are reserved.';
    } else if (/^sec-/i.test(normalized)) {
      errors[`header:${name}`] = 'Browser security headers are reserved.';
    }
    if (/\r|\n/.test(value)) {
      errors[`header:${name}`] = 'Header values must not contain line breaks.';
    }
  }

  const seenModels = new Set<string>();
  for (const model of input.manualModels ?? []) {
    const id = model.id.trim();
    if (!id) errors['manualModels'] = 'Manual model IDs must not be blank.';
    if (seenModels.has(id)) {
      errors['manualModels'] = 'Manual model IDs must be unique.';
    }
    seenModels.add(id);
  }
  return errors;
}

export function normalizeCustomProviderDefinition(
  input: CustomProviderDefinitionInput,
): CustomProviderDefinition {
  const errors = validateCustomProviderDefinition(input);
  if (Object.keys(errors).length > 0) {
    throw new Error(Object.values(errors)[0]);
  }
  const id = input.id ?? createCustomProviderId();
  return {
    version: CUSTOM_PROVIDER_DEFINITION_VERSION,
    id,
    displayName: input.displayName.trim(),
    dialect: input.dialect,
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
    credentialPlacement:
      input.credentialPlacement ?? defaultCredentialPlacement(input.dialect),
    safeHeaders: Object.fromEntries(
      Object.entries(input.safeHeaders ?? {}).map(([name, value]) => [
        name.trim(),
        value.trim(),
      ]),
    ),
    manualModels: (input.manualModels ?? []).map((model) => ({
      ...model,
      id: model.id.trim(),
      ...(model.name?.trim() ? { name: model.name.trim() } : {}),
    })),
  };
}

export function setCustomProviderDefinitions(
  definitions: readonly CustomProviderDefinitionInput[],
): void {
  DEFINITIONS.clear();
  for (const raw of definitions) {
    const definition = normalizeCustomProviderDefinition(raw);
    DEFINITIONS.set(definition.id, definition);
  }
}

export function upsertCustomProviderDefinition(
  input: CustomProviderDefinitionInput,
): CustomProviderDefinition {
  const definition = normalizeCustomProviderDefinition(input);
  DEFINITIONS.set(definition.id, definition);
  return definition;
}

export function removeCustomProviderDefinition(providerId: string): boolean {
  return DEFINITIONS.delete(providerId);
}

export function getCustomProviderDefinition(
  providerId: string,
): CustomProviderDefinition | undefined {
  return DEFINITIONS.get(providerId);
}

export function listCustomProviderDefinitions(): CustomProviderDefinition[] {
  return [...DEFINITIONS.values()];
}

export function customDefinitionToProvider(
  definition: CustomProviderDefinition,
): PlumbProvider {
  const keyless = definition.credentialPlacement === 'none';
  return {
    id: definition.id,
    name: definition.displayName,
    category: PlumbProviderCategory.CUSTOM_ENDPOINT,
    description: `${definition.dialect} custom endpoint`,
    authMethods: keyless ? [{ type: 'none' }] : [{ type: 'api_key' }],
    available: true,
    allowUnauthenticated: keyless,
    group: 'Custom Endpoints',
  };
}

export function listCustomPlumbProviders(): PlumbProvider[] {
  return listCustomProviderDefinitions().map(customDefinitionToProvider);
}

export function customDefinitionToModels(
  definition: CustomProviderDefinition,
): PlumbModel[] {
  return definition.manualModels.map((model) => ({
    id: model.id,
    provider: definition.id,
    name: model.name,
    api: definition.dialect as PlumbKnownApi,
    baseUrl: definition.baseUrl,
    headers: { ...definition.safeHeaders },
    contextWindow: model.contextWindow ?? 131072,
    maxTokens: model.maxTokens ?? 32768,
    reasoning: model.reasoning,
    toolsSupported: model.toolsSupported,
    // PlumbModel.toolsCapabilitySource is required whenever toolsSupported
    // is defined (see types.ts) -- a user-configured custom provider model
    // that explicitly declares toolsSupported=true/false must carry
    // source=USER_CONFIGURED so getEffectiveToolsAdvertisable's downstream
    // consumers can trust it; leaving toolsSupported unset must leave
    // toolsCapabilitySource unset too (stays UNKNOWN, never guessed).
    toolsCapabilitySource:
      model.toolsSupported !== undefined ? 'USER_CONFIGURED' : undefined,
    input: model.input ?? 'text',
    source: 'USER_CONFIGURED',
  }));
}

export function __resetCustomProviderDefinitionsForTests(): void {
  DEFINITIONS.clear();
}

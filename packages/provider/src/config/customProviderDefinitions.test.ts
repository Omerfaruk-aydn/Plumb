/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetCustomProviderDefinitionsForTests,
  customDefinitionToModels,
  getCustomProviderDefinition,
  listCustomPlumbProviders,
  normalizeCustomProviderDefinition,
  upsertCustomProviderDefinition,
  validateCustomProviderDefinition,
} from './customProviderDefinitions.js';
import { PlumbModelRegistry } from '../registry/model-registry.js';

const ID = 'custom:123e4567-e89b-42d3-a456-426614174000';

describe('custom provider definitions', () => {
  afterEach(__resetCustomProviderDefinitionsForTests);

  it('keeps a stable instance ID across rename and projects manual models', () => {
    const original = upsertCustomProviderDefinition({
      id: ID,
      displayName: 'Private Gateway',
      dialect: 'openai-completions',
      baseUrl: 'https://gateway.example.test/v1/',
      credentialPlacement: 'bearer',
      safeHeaders: { 'X-Tenant': 'acme' },
      manualModels: [
        {
          id: 'private-model',
          contextWindow: 8192,
          toolsSupported: true,
        },
      ],
    });
    const renamed = upsertCustomProviderDefinition({
      ...original,
      displayName: 'Renamed Gateway',
    });

    expect(renamed.id).toBe(ID);
    expect(getCustomProviderDefinition(ID)?.displayName).toBe(
      'Renamed Gateway',
    );
    expect(listCustomPlumbProviders()).toMatchObject([
      { id: ID, name: 'Renamed Gateway', available: true },
    ]);
    expect(customDefinitionToModels(renamed)).toMatchObject([
      {
        id: 'private-model',
        provider: ID,
        api: 'openai-completions',
        baseUrl: 'https://gateway.example.test/v1',
        headers: { 'X-Tenant': 'acme' },
        source: 'USER_CONFIGURED',
        toolsSupported: true,
      },
    ]);
  });

  it('rejects reserved headers, CRLF, embedded URL credentials, and duplicate models', () => {
    expect(
      validateCustomProviderDefinition({
        id: ID,
        displayName: 'Unsafe',
        dialect: 'openai-completions',
        baseUrl: 'https://user:secret@example.test/v1',
        safeHeaders: {
          authorization: 'Bearer attacker',
          'X-Trace': 'ok\r\nx-evil: yes',
        },
        manualModels: [{ id: 'same' }, { id: 'same' }],
      }),
    ).toMatchObject({
      baseUrl: 'Do not embed credentials in the Base URL.',
      'header:authorization':
        'Authentication, sensitive, and hop-by-hop headers are reserved.',
      'header:X-Trace': 'Header values must not contain line breaks.',
      manualModels: 'Manual model IDs must be unique.',
    });
  });

  it('uses dialect-specific credential defaults and rejects query keys elsewhere', () => {
    expect(
      normalizeCustomProviderDefinition({
        id: ID,
        displayName: 'Anthropic proxy',
        dialect: 'anthropic-messages',
        baseUrl: 'https://anthropic.example.test',
      }).credentialPlacement,
    ).toBe('x-api-key');
    expect(
      validateCustomProviderDefinition({
        id: ID,
        displayName: 'Wrong query auth',
        dialect: 'openai-completions',
        baseUrl: 'https://openai.example.test/v1',
        credentialPlacement: 'query-key',
      }),
    ).toHaveProperty('credentialPlacement');
  });

  it('hydrates manual models before request-one resolution', () => {
    upsertCustomProviderDefinition({
      id: ID,
      displayName: 'Cold custom',
      dialect: 'openai-completions',
      baseUrl: 'https://cold.example.test/v1',
      manualModels: [{ id: 'cold-model' }],
    });
    const registry = new PlumbModelRegistry();
    registry.hydrateCustomProviderModels();

    expect(registry.findModel(ID, 'cold-model')).toMatchObject({
      provider: ID,
      api: 'openai-completions',
      baseUrl: 'https://cold.example.test/v1',
      source: 'USER_CONFIGURED',
    });
  });
});

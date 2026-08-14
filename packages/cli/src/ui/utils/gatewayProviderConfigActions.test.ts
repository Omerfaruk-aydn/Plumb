/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(async () => undefined),
  setAuthenticated: vi.fn(async () => undefined),
  invalidateCache: vi.fn(),
  discoverProviderModels: vi.fn(async () => []),
  getApiKey: vi.fn(async () => undefined as string | undefined),
  hasCredentials: vi.fn(async () => false),
  removeCredentials: vi.fn(async () => undefined),
  saveProviderCloudConfig: vi.fn(async () => undefined),
}));

vi.mock('@plumb/provider', () => ({
  getGatewayProviderConfigSchema: vi.fn(() => ({
    providerId: 'portkey',
    authModes: [
      {
        id: 'provider',
        label: 'Provider header',
        fields: [
          {
            id: 'baseUrl',
            label: 'Base URL',
            secret: false,
            envVar: 'PORTKEY_BASE_URL',
          },
          { id: 'routingValue', label: 'Provider', secret: false },
          { id: 'credential', label: 'API key', secret: true },
        ],
      },
    ],
  })),
  resolveGatewayProviderBaseUrl: vi.fn(() => 'https://api.portkey.ai/v1'),
  validateGatewayProviderConfig: vi.fn(() => ({})),
  buildGatewayProviderSaveOperation: vi.fn((_providerId, values) => ({
    safeConfig: {
      authMode: values.authMode,
      baseUrl: values.baseUrl,
      routingMode: values.authMode,
      portkeyProvider: values.routingValue,
    },
    credential: values.credential,
  })),
  resolveProviderSafeConfig: vi.fn(() => ({})),
  resolveProviderConfigValue: vi.fn(() => undefined),
  getPlumbProviderRegistry: vi.fn(() => ({
    initialize: mocks.initialize,
    setAuthenticated: mocks.setAuthenticated,
  })),
  getPlumbModelRegistry: vi.fn(() => ({
    invalidateCache: mocks.invalidateCache,
    discoverProviderModels: mocks.discoverProviderModels,
  })),
  ensurePlumbCredentialStore: vi.fn(async () => ({
    getApiKey: mocks.getApiKey,
    hasCredentials: mocks.hasCredentials,
    removeCredentials: mocks.removeCredentials,
  })),
}));

vi.mock('@plumb/core', () => ({
  getCachedProviderCloudConfig: vi.fn(() => ({})),
  saveProviderCloudConfig: mocks.saveProviderCloudConfig,
  clearProviderCloudConfig: vi.fn(async () => undefined),
}));

import {
  __resetGatewayProviderConfigActionsForTests,
  getGatewayProviderConfigActions,
} from './gatewayProviderConfigActions.js';

describe('gatewayProviderConfigActions', () => {
  beforeEach(() => {
    __resetGatewayProviderConfigActionsForTests();
    for (const mock of Object.values(mocks)) mock.mockClear();
    mocks.getApiKey.mockResolvedValue(undefined);
  });

  it('persists Portkey routing separately and discovers immediately', async () => {
    mocks.getApiKey.mockResolvedValue('portkey-secret');
    const actions = getGatewayProviderConfigActions('portkey');

    await expect(
      actions?.save({
        authMode: 'provider',
        baseUrl: 'https://api.portkey.ai/v1',
        routingValue: 'openai',
        credential: 'portkey-secret',
      }),
    ).resolves.toEqual({ success: true });

    expect(mocks.setAuthenticated).toHaveBeenCalledWith('portkey', {
      type: 'api_key',
      provider: 'portkey',
      key: 'portkey-secret',
    });
    expect(mocks.saveProviderCloudConfig).toHaveBeenCalledWith('portkey', {
      authMode: 'provider',
      baseUrl: 'https://api.portkey.ai/v1',
      routingMode: 'provider',
      portkeyProvider: 'openai',
    });
    expect(mocks.discoverProviderModels).toHaveBeenCalledWith(
      'portkey',
      'portkey-secret',
    );
  });
});

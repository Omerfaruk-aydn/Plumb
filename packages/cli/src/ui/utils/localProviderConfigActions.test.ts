/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
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
  clearProviderCloudConfig: vi.fn(async () => undefined),
}));

vi.mock('@google/gemini-cli-provider', () => ({
  getLocalProviderConfigSchema: vi.fn(() => ({
    providerId: 'vllm',
    authModes: [
      {
        id: 'none',
        label: 'No authentication',
        fields: [
          {
            id: 'baseUrl',
            label: 'OpenAI-compatible base URL',
            secret: false,
            envVar: 'VLLM_BASE_URL',
          },
        ],
      },
      {
        id: 'bearer',
        label: 'Bearer token',
        fields: [
          {
            id: 'baseUrl',
            label: 'OpenAI-compatible base URL',
            secret: false,
            envVar: 'VLLM_BASE_URL',
          },
          { id: 'credential', label: 'Bearer token', secret: true },
        ],
      },
    ],
  })),
  getLocalProviderEndpointDefinition: vi.fn(() => ({
    providerId: 'vllm',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    api: 'openai-completions',
  })),
  validateLocalProviderConfig: vi.fn(() => ({})),
  buildLocalProviderSaveOperation: vi.fn((_providerId, values) => ({
    safeConfig: {
      authMode: values.authMode,
      baseUrl: values.baseUrl,
    },
    ...(values.credential ? { credential: values.credential } : {}),
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

vi.mock('@google/gemini-cli-core', () => ({
  getCachedProviderCloudConfig: vi.fn(() => ({})),
  saveProviderCloudConfig: mocks.saveProviderCloudConfig,
  clearProviderCloudConfig: mocks.clearProviderCloudConfig,
}));

import {
  __resetLocalProviderConfigActionsForTests,
  getLocalProviderConfigActions,
} from './localProviderConfigActions.js';

describe('localProviderConfigActions', () => {
  beforeEach(() => {
    __resetLocalProviderConfigActionsForTests();
    for (const mock of Object.values(mocks)) mock.mockClear();
    mocks.getApiKey.mockResolvedValue(undefined);
  });

  it('loads a keyless local provider with its safe default endpoint', async () => {
    const actions = getLocalProviderConfigActions('vllm');

    await expect(actions?.load()).resolves.toMatchObject({
      safeConfig: {
        authMode: 'none',
        baseUrl: 'http://127.0.0.1:8000/v1',
      },
      hasCredential: false,
    });
  });

  it('persists bearer auth through the live registry and discovers immediately', async () => {
    mocks.getApiKey.mockResolvedValue('local-secret');
    const actions = getLocalProviderConfigActions('vllm');

    await expect(
      actions?.save({
        authMode: 'bearer',
        baseUrl: 'http://10.0.0.5:9000/v1',
        credential: 'local-secret',
      }),
    ).resolves.toEqual({ success: true });

    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.setAuthenticated).toHaveBeenCalledWith('vllm', {
      type: 'api_key',
      provider: 'vllm',
      key: 'local-secret',
    });
    expect(mocks.saveProviderCloudConfig).toHaveBeenCalledWith('vllm', {
      authMode: 'bearer',
      baseUrl: 'http://10.0.0.5:9000/v1',
    });
    expect(mocks.invalidateCache).toHaveBeenCalledWith('vllm');
    expect(mocks.discoverProviderModels).toHaveBeenCalledWith(
      'vllm',
      'local-secret',
    );
  });

  it('discovers keyless endpoints without manufacturing a credential', async () => {
    const actions = getLocalProviderConfigActions('vllm');

    await actions?.save({
      authMode: 'none',
      baseUrl: 'http://127.0.0.1:8000/v1',
    });

    expect(mocks.setAuthenticated).not.toHaveBeenCalled();
    expect(mocks.discoverProviderModels).toHaveBeenCalledWith(
      'vllm',
      undefined,
    );
  });
});

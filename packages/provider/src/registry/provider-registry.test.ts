/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression: logout must invalidate the model registry's in-memory
 * discovered-model cache for that provider, not just the on-disk cache —
 * otherwise a currently-running process that logs out and back in as a
 * DIFFERENT account on the same provider keeps serving the previous
 * account's discovered models until restart (a cross-account stale-
 * entitlement leak).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRemoveCredentials = vi.fn().mockResolvedValue(undefined);
const mockInvalidateModelCache = vi.fn();
const mockInvalidateCache = vi.fn();
const mockGetPlumbModelRegistry = vi.fn(() => ({
  invalidateCache: mockInvalidateCache,
}));

vi.mock('../auth/credential-store.js', () => ({
  ensurePlumbCredentialStore: vi.fn(async () => ({
    listAuthenticatedProviders: vi.fn(async () => []),
    getCredentials: vi.fn(async () => []),
    removeCredentials: mockRemoveCredentials,
    storeCredential: vi.fn(async () => {}),
    getApiKey: vi.fn(async () => undefined),
  })),
}));

vi.mock('./model-cache.js', () => ({
  invalidateModelCache: mockInvalidateModelCache,
  readModelCache: vi.fn(),
  writeModelCache: vi.fn(),
  invalidateAllModelCache: vi.fn(),
}));

vi.mock('./model-registry.js', () => ({
  getPlumbModelRegistry: mockGetPlumbModelRegistry,
}));

vi.mock('../catalog/providers.js', () => ({
  SELECTABLE_PROVIDERS: [],
  getPlumbProvider: vi.fn(() => ({
    id: 'github-copilot',
    name: 'GitHub Copilot',
    category: 'coding_plan',
    authMethods: [],
    available: true,
  })),
  getProviderSetupGroups: vi.fn(() => new Map()),
}));

const { PlumbProviderRegistry } = await import('./provider-registry.js');

describe('PlumbProviderRegistry.logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates both the on-disk model cache and the model registry in-memory cache for the logged-out provider', async () => {
    const registry = new PlumbProviderRegistry();
    await registry.initialize();

    await registry.logout('github-copilot');

    expect(mockRemoveCredentials).toHaveBeenCalledWith('github-copilot');
    expect(mockInvalidateModelCache).toHaveBeenCalledWith('github-copilot');
    // The regression: this call was previously never made — a currently
    // running process would keep serving the previous account's
    // discovered models after logout+re-login.
    expect(mockGetPlumbModelRegistry).toHaveBeenCalled();
    expect(mockInvalidateCache).toHaveBeenCalledWith('github-copilot');
  });

  it('clears the selected provider when logging out of the currently-selected one', async () => {
    const registry = new PlumbProviderRegistry();
    await registry.initialize();
    registry.selectProvider('github-copilot');
    expect(registry.getSelectedProvider()).toBe('github-copilot');

    await registry.logout('github-copilot');

    expect(registry.getSelectedProvider()).toBeNull();
  });

  it('does not throw when the model registry module fails to load (non-fatal, on-disk cache is still invalidated)', async () => {
    mockGetPlumbModelRegistry.mockImplementationOnce(() => {
      throw new Error('module unavailable');
    });
    const registry = new PlumbProviderRegistry();
    await registry.initialize();

    await expect(registry.logout('github-copilot')).resolves.not.toThrow();
    expect(mockInvalidateModelCache).toHaveBeenCalledWith('github-copilot');
  });
});

describe('PlumbProviderRegistry.setAuthenticated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates both the on-disk model cache and the model registry in-memory cache when re-authenticating without a prior explicit logout (account switch)', async () => {
    const registry = new PlumbProviderRegistry();
    await registry.initialize();

    await registry.setAuthenticated('github-copilot', {
      type: 'api_key',
      provider: 'github-copilot',
      key: 'new-account-key',
    });

    expect(mockInvalidateModelCache).toHaveBeenCalledWith('github-copilot');
    // The regression this guards against: switching accounts by calling
    // setAuthenticated() again (no explicit logout() in between) must not
    // let the previous account's discovered models keep being served from
    // the in-memory PlumbModelRegistry cache.
    expect(mockGetPlumbModelRegistry).toHaveBeenCalled();
    expect(mockInvalidateCache).toHaveBeenCalledWith('github-copilot');
  });
});

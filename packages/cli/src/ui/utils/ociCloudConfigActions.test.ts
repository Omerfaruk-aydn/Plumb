/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the canonical OCI configuration orchestration -- the
 * domain schema (validateOciConfig/buildOciSaveOperation) is tested
 * separately against real logic; here only the persistence boundary
 * (credential store / cloud-config cache) is mocked, so these tests verify
 * this module's own sequencing/atomicity/precedence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStoreApiKeyCredential = vi.fn();
const mockHasCredentials = vi.fn();
const mockRemoveCredentials = vi.fn();
const mockEnsurePlumbCredentialStore = vi.fn();
const mockResolveProviderSafeConfig = vi.fn();
const mockResolveProviderConfigValue = vi.fn();
const mockRemoveOmpModelCacheEntry = vi.fn();

const mockSaveProviderCloudConfig = vi.fn();
const mockGetCachedProviderCloudConfig = vi.fn();
const mockClearProviderCloudConfig = vi.fn();

vi.mock('@google/gemini-cli-provider', () => ({
  validateOciConfig: (
    values: Record<string, unknown>,
  ): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!values['region']) errors['region'] = 'Region is required.';
    return errors;
  },
  buildOciSaveOperation: (values: Record<string, unknown>) => {
    const safeConfig: Record<string, string> = {
      region: String(values['region'] ?? ''),
      projectId: String(values['projectId'] ?? ''),
    };
    const credential = values['credential']
      ? String(values['credential'])
      : undefined;
    return { safeConfig, ...(credential ? { credential } : {}) };
  },
  ensurePlumbCredentialStore: () => mockEnsurePlumbCredentialStore(),
  resolveProviderSafeConfig: (...args: unknown[]) =>
    mockResolveProviderSafeConfig(...args),
  resolveProviderConfigValue: (...args: unknown[]) =>
    mockResolveProviderConfigValue(...args),
  removeOmpModelCacheEntry: (...args: unknown[]) =>
    mockRemoveOmpModelCacheEntry(...args),
}));

vi.mock('@google/gemini-cli-core', () => ({
  saveProviderCloudConfig: (...args: unknown[]) =>
    mockSaveProviderCloudConfig(...args),
  getCachedProviderCloudConfig: (...args: unknown[]) =>
    mockGetCachedProviderCloudConfig(...args),
  clearProviderCloudConfig: (...args: unknown[]) =>
    mockClearProviderCloudConfig(...args),
}));

import {
  saveOciConfiguration,
  loadOciExistingConfig,
  removeOciConfiguration,
  refreshOciModelStatus,
  clearOciConfigOverrides,
  getOciFieldSources,
} from './ociCloudConfigActions.js';

describe('ociCloudConfigActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsurePlumbCredentialStore.mockResolvedValue({
      storeApiKeyCredential: mockStoreApiKeyCredential,
      hasCredentials: mockHasCredentials,
      removeCredentials: mockRemoveCredentials,
    });
    mockGetCachedProviderCloudConfig.mockReturnValue({});
    mockResolveProviderSafeConfig.mockReturnValue({});
    mockResolveProviderConfigValue.mockReturnValue(undefined);
  });

  describe('saveOciConfiguration', () => {
    it('returns validation errors and never touches the credential store or cloud config when required fields are missing', async () => {
      const result = await saveOciConfiguration({ authMode: 'api_key' });
      expect(result.success).toBe(false);
      expect(result.fieldErrors).toEqual({ region: 'Region is required.' });
      expect(mockEnsurePlumbCredentialStore).not.toHaveBeenCalled();
      expect(mockSaveProviderCloudConfig).not.toHaveBeenCalled();
    });

    it('is atomic on credential-store failure: never calls saveProviderCloudConfig', async () => {
      mockStoreApiKeyCredential.mockRejectedValue(new Error('keychain down'));
      const result = await saveOciConfiguration({
        authMode: 'api_key',
        region: 'us-chicago-1',
        credential: 'sekret',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('keychain down');
      expect(mockSaveProviderCloudConfig).not.toHaveBeenCalled();
    });

    it('surfaces a cloud-config write failure even after the credential already saved', async () => {
      mockStoreApiKeyCredential.mockResolvedValue(undefined);
      mockSaveProviderCloudConfig.mockRejectedValue(new Error('disk full'));
      const result = await saveOciConfiguration({
        authMode: 'api_key',
        region: 'us-chicago-1',
        credential: 'sekret',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('disk full');
    });

    it('on success, persists the credential then the safe config in order', async () => {
      mockStoreApiKeyCredential.mockResolvedValue(undefined);
      mockSaveProviderCloudConfig.mockResolvedValue(undefined);
      const callOrder: string[] = [];
      mockStoreApiKeyCredential.mockImplementation(async () => {
        callOrder.push('credential');
      });
      mockSaveProviderCloudConfig.mockImplementation(async () => {
        callOrder.push('safeConfig');
      });

      const result = await saveOciConfiguration({
        authMode: 'api_key',
        region: 'us-chicago-1',
        projectId: 'ocid1.generativeaiproject.oc1..real',
        credential: 'sekret',
      });

      expect(result.success).toBe(true);
      expect(callOrder).toEqual(['credential', 'safeConfig']);
      expect(mockSaveProviderCloudConfig).toHaveBeenCalledWith(
        'oci-genai',
        expect.objectContaining({ region: 'us-chicago-1' }),
      );
    });

    it('does not touch the credential store when no new credential was entered', async () => {
      mockSaveProviderCloudConfig.mockResolvedValue(undefined);
      const result = await saveOciConfiguration({
        authMode: 'iam',
        region: 'us-chicago-1',
      });
      expect(result.success).toBe(true);
      expect(mockEnsurePlumbCredentialStore).not.toHaveBeenCalled();
    });
  });

  describe('loadOciExistingConfig', () => {
    it('reports hasCredential=false without throwing when the store is unavailable', async () => {
      mockEnsurePlumbCredentialStore.mockRejectedValue(new Error('locked'));
      const result = await loadOciExistingConfig();
      expect(result.hasCredential).toBe(false);
    });

    it('merges the effective (PLUMB override > env > default) region/projectId/compartmentId into the returned safe config', async () => {
      mockHasCredentials.mockResolvedValue(true);
      mockGetCachedProviderCloudConfig.mockReturnValue({ region: 'stale' });
      mockResolveProviderConfigValue.mockImplementation(
        (_providerId: string, field: string) => {
          if (field === 'region') return 'us-chicago-1';
          if (field === 'projectId') return 'ocid1.generativeaiproject...';
          return undefined;
        },
      );

      const result = await loadOciExistingConfig();

      expect(result.safeConfig['region']).toBe('us-chicago-1');
      expect(result.safeConfig['projectId']).toBe(
        'ocid1.generativeaiproject...',
      );
      expect(result.safeConfig['compartmentId']).toBeUndefined();
    });

    it('reports each field source as PLUMB when the safe config has it, env when only the environment does, none otherwise', async () => {
      mockHasCredentials.mockResolvedValue(false);
      mockResolveProviderSafeConfig.mockReturnValue({ region: 'us-chicago-1' });
      const originalEnv = { ...process.env };
      process.env['OCI_GENAI_PROJECT_ID'] = 'ocid1.generativeaiproject...';
      try {
        const sources = getOciFieldSources();
        expect(sources['region']).toBe('plumb');
        expect(sources['projectId']).toBe('env');
        expect(sources['compartmentId']).toBe('none');
      } finally {
        process.env = originalEnv;
      }
    });
  });

  describe('removeOciConfiguration', () => {
    it('clears the cloud config and the credential, tolerating a credential-store failure', async () => {
      mockClearProviderCloudConfig.mockResolvedValue(undefined);
      mockRemoveCredentials.mockRejectedValue(new Error('locked'));
      await expect(removeOciConfiguration()).resolves.toBeUndefined();
      expect(mockClearProviderCloudConfig).toHaveBeenCalledWith('oci-genai');
    });
  });

  describe('clearOciConfigOverrides', () => {
    it('removes only region/projectId/compartmentId, preserving authMode/iamAuthMode/credential-adjacent keys', async () => {
      mockGetCachedProviderCloudConfig.mockReturnValue({
        region: 'us-chicago-1',
        projectId: 'ocid1.generativeaiproject...',
        compartmentId: 'ocid1.compartment...',
        iamAuthMode: 'config_profile',
        iamConfigProfile: 'DEFAULT',
      });
      mockSaveProviderCloudConfig.mockResolvedValue(undefined);

      await clearOciConfigOverrides();

      expect(mockSaveProviderCloudConfig).toHaveBeenCalledWith('oci-genai', {
        iamAuthMode: 'config_profile',
        iamConfigProfile: 'DEFAULT',
      });
    });
  });

  describe('refreshOciModelStatus', () => {
    it('drops the OCI model-discovery cache entry', async () => {
      await refreshOciModelStatus();
      expect(mockRemoveOmpModelCacheEntry).toHaveBeenCalledWith('oci-genai');
    });
  });
});

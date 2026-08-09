/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  validateAzureConfig,
  buildAzureSaveOperation,
  encodeAzureDeploymentMap,
  decodeAzureDeploymentMap,
  decodeAzureEndpoint,
  type AzureConfigFormValues,
} from './azureConfigSchema.js';

describe('azureConfigSchema', () => {
  describe('validateAzureConfig', () => {
    it('requires an endpoint', () => {
      const errors = validateAzureConfig({
        endpoint: '',
        credential: 'sk-x',
        deployments: [],
      });
      expect(errors.endpoint).toBeDefined();
    });

    it('requires a credential unless one already exists', () => {
      const errors = validateAzureConfig({
        endpoint: 'my-resource',
        credential: '',
        hasExistingCredential: false,
        deployments: [],
      });
      expect(errors.credential).toBeDefined();
    });

    it('does not require a credential when one is already configured and left blank', () => {
      const errors = validateAzureConfig({
        endpoint: 'my-resource',
        credential: '',
        hasExistingCredential: true,
        deployments: [],
      });
      expect(errors.credential).toBeUndefined();
    });

    it('rejects a deployment missing either half of the mapping', () => {
      const errors = validateAzureConfig({
        endpoint: 'my-resource',
        credential: 'sk-x',
        deployments: [{ modelId: 'gpt-4o', deploymentName: '' }],
      });
      expect(errors.deployments).toBeDefined();
    });

    it('rejects duplicate model IDs across deployments', () => {
      const errors = validateAzureConfig({
        endpoint: 'my-resource',
        credential: 'sk-x',
        deployments: [
          { modelId: 'gpt-4o', deploymentName: 'dep-a' },
          { modelId: 'gpt-4o', deploymentName: 'dep-b' },
        ],
      });
      expect(errors.deployments).toContain('gpt-4o');
    });

    it('accepts a fully valid config with no deployments (deployments are optional)', () => {
      const errors = validateAzureConfig({
        endpoint: 'my-resource',
        credential: 'sk-x',
        deployments: [],
      });
      expect(Object.keys(errors)).toHaveLength(0);
    });
  });

  describe('buildAzureSaveOperation', () => {
    it('stores a URL-shaped endpoint as baseUrl', () => {
      const { safeConfig } = buildAzureSaveOperation({
        endpoint: 'https://my-resource.openai.azure.com',
        deployments: [],
      });
      expect(safeConfig['baseUrl']).toBe(
        'https://my-resource.openai.azure.com',
      );
      expect(safeConfig['resourceName']).toBeUndefined();
    });

    it('stores a bare name as resourceName', () => {
      const { safeConfig } = buildAzureSaveOperation({
        endpoint: 'my-resource',
        deployments: [],
      });
      expect(safeConfig['resourceName']).toBe('my-resource');
      expect(safeConfig['baseUrl']).toBeUndefined();
    });

    it('encodes deployments in the model=deployment,... shape', () => {
      const { safeConfig } = buildAzureSaveOperation({
        endpoint: 'my-resource',
        deployments: [
          { modelId: 'gpt-4o', deploymentName: 'prod-4o' },
          { modelId: 'gpt-4o-mini', deploymentName: 'prod-mini' },
        ],
      });
      expect(safeConfig['deploymentMap']).toBe(
        'gpt-4o=prod-4o,gpt-4o-mini=prod-mini',
      );
    });

    it('never puts the credential in the safe config, even when a new one is submitted', () => {
      const { safeConfig, credential } = buildAzureSaveOperation({
        endpoint: 'my-resource',
        credential: 'sk-new',
        deployments: [],
      });
      expect(credential).toBe('sk-new');
      expect(Object.values(safeConfig)).not.toContain('sk-new');
    });

    it('omits credential from the result when the form left it blank (preserve-existing)', () => {
      const values: AzureConfigFormValues = {
        endpoint: 'my-resource',
        credential: '',
        hasExistingCredential: true,
        deployments: [],
      };
      const { credential } = buildAzureSaveOperation(values);
      expect(credential).toBeUndefined();
    });
  });

  describe("deployment map codec (must round-trip and match parseAzureDeploymentNameMap's shape)", () => {
    it('round-trips through encode/decode', () => {
      const deployments = [
        { modelId: 'gpt-4o', deploymentName: 'prod-4o' },
        { modelId: 'gpt-4o-mini', deploymentName: 'prod-mini' },
      ];
      const encoded = encodeAzureDeploymentMap(deployments);
      expect(decodeAzureDeploymentMap(encoded)).toEqual(deployments);
    });

    it('decodes an empty/undefined map to an empty list', () => {
      expect(decodeAzureDeploymentMap(undefined)).toEqual([]);
      expect(decodeAzureDeploymentMap('')).toEqual([]);
    });

    it('ignores malformed entries without throwing', () => {
      expect(
        decodeAzureDeploymentMap('bad-entry,gpt-4o=prod-4o,=missing-model'),
      ).toEqual([{ modelId: 'gpt-4o', deploymentName: 'prod-4o' }]);
    });
  });

  describe('decodeAzureEndpoint', () => {
    it('prefers baseUrl over resourceName when both are somehow present', () => {
      expect(
        decodeAzureEndpoint({
          baseUrl: 'https://x.openai.azure.com',
          resourceName: 'x',
        }),
      ).toBe('https://x.openai.azure.com');
    });

    it('falls back to resourceName', () => {
      expect(decodeAzureEndpoint({ resourceName: 'my-resource' })).toBe(
        'my-resource',
      );
    });

    it('returns empty string when neither is present', () => {
      expect(decodeAzureEndpoint({})).toBe('');
    });
  });
});

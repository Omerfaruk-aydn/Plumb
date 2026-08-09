/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  getVisibleCloudFields,
  validateCloudConfig,
  buildCloudSaveOperation,
} from './cloudConfigSchema.js';
import {
  BEDROCK_CONFIG_SCHEMA,
  validateBedrockConfig,
  buildBedrockSaveOperation,
} from './bedrockConfigSchema.js';
import {
  VERTEX_CONFIG_SCHEMA,
  validateVertexConfig,
  buildVertexSaveOperation,
} from './vertexConfigSchema.js';
import {
  WATSONX_CONFIG_SCHEMA,
  validateWatsonxConfig,
  buildWatsonxSaveOperation,
} from './watsonxConfigSchema.js';

describe('generic cloud config engine', () => {
  describe('getVisibleCloudFields', () => {
    it('returns [] for an unknown auth mode', () => {
      expect(getVisibleCloudFields(BEDROCK_CONFIG_SCHEMA, 'nonsense')).toEqual(
        [],
      );
    });
  });

  describe('Bedrock', () => {
    it('requires region for the default credential chain, no credential field at all', () => {
      const errors = validateBedrockConfig({ authMode: 'default_chain' });
      expect(errors['region']).toBeDefined();
      const fields = getVisibleCloudFields(
        BEDROCK_CONFIG_SCHEMA,
        'default_chain',
      );
      expect(fields.some((f) => f.secret)).toBe(false);
    });

    it('requires a profile name for profile mode', () => {
      const errors = validateBedrockConfig({
        authMode: 'profile',
        region: 'us-east-1',
      });
      expect(errors['profileName']).toBeDefined();
    });

    it('save operation never returns a credential (Bedrock delegates to the AWS SDK chain)', () => {
      const { credential, safeConfig } = buildBedrockSaveOperation({
        authMode: 'profile',
        region: 'us-east-1',
        profileName: 'bedrock-prod',
      });
      expect(credential).toBeUndefined();
      expect(safeConfig).toEqual({
        authMode: 'profile',
        region: 'us-east-1',
        profileName: 'bedrock-prod',
      });
    });

    it('passes with a fully valid default_chain config', () => {
      expect(
        validateBedrockConfig({
          authMode: 'default_chain',
          region: 'us-east-1',
        }),
      ).toEqual({});
    });
  });

  describe('Vertex', () => {
    it('requires credential for api_key mode unless already configured', () => {
      const errors = validateVertexConfig({
        authMode: 'api_key',
        project: 'p',
        location: 'us-central1',
      });
      expect(errors['credential']).toBeDefined();
    });

    it('does not require a credential field at all for ADC mode', () => {
      const errors = validateVertexConfig({
        authMode: 'adc',
        project: 'p',
        location: 'us-central1',
      });
      expect(errors['credential']).toBeUndefined();
      const fields = getVisibleCloudFields(VERTEX_CONFIG_SCHEMA, 'adc');
      expect(fields.some((f) => f.secret)).toBe(false);
    });

    it('save operation includes the credential only for api_key mode with a new key entered', () => {
      const adc = buildVertexSaveOperation({
        authMode: 'adc',
        project: 'p',
        location: 'us-central1',
      });
      expect(adc.credential).toBeUndefined();

      const apiKey = buildVertexSaveOperation({
        authMode: 'api_key',
        project: 'p',
        location: 'us-central1',
        credential: 'vertex-key',
      });
      expect(apiKey.credential).toBe('vertex-key');
    });
  });

  describe('watsonx', () => {
    it('project and space are mutually exclusive via the auth-mode selector -- selecting project never surfaces spaceId', () => {
      const fields = getVisibleCloudFields(WATSONX_CONFIG_SCHEMA, 'project');
      expect(fields.some((f) => f.id === 'spaceId')).toBe(false);
      expect(fields.some((f) => f.id === 'projectId')).toBe(true);
    });

    it('requires the credential (no PLUMB-managed non-secret auth path for watsonx)', () => {
      const errors = validateWatsonxConfig({
        authMode: 'project',
        projectId: 'proj-1',
        region: 'us-south',
      });
      expect(errors['credential']).toBeDefined();
    });

    it('save operation only writes the scope-relevant ID field', () => {
      const { safeConfig } = buildWatsonxSaveOperation({
        authMode: 'space',
        spaceId: 'space-1',
        region: 'us-south',
        credential: 'wx-key',
      });
      expect(safeConfig['spaceId']).toBe('space-1');
      expect(safeConfig['projectId']).toBeUndefined();
    });
  });

  describe('validateCloudConfig / buildCloudSaveOperation atomicity', () => {
    it('rejects an unrecognized authMode without inspecting other fields', () => {
      const errors = validateCloudConfig(BEDROCK_CONFIG_SCHEMA, {
        authMode: 'not-a-real-mode',
      });
      expect(errors['authMode']).toBeDefined();
      expect(Object.keys(errors)).toEqual(['authMode']);
    });

    it('buildCloudSaveOperation drops blank optional fields rather than writing empty strings', () => {
      const { safeConfig } = buildCloudSaveOperation(BEDROCK_CONFIG_SCHEMA, {
        authMode: 'default_chain',
        region: '  ',
      });
      expect(safeConfig['region']).toBeUndefined();
    });
  });
});

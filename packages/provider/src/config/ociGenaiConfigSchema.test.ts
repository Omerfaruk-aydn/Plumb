/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * OCI configuration domain schema: conditional field visibility, canonical
 * validation, and the safe/secret save-mapping split. This is the single
 * source of truth the Ink UI must render/validate from -- these tests
 * exist so the UI can never silently drift from these rules.
 */
import { describe, it, expect } from 'vitest';
import {
  getVisibleOciFields,
  validateOciConfig,
  buildOciSaveOperation,
  OCI_GENAI_CONFIG_SCHEMA,
} from './ociGenaiConfigSchema.js';

describe('OCI_GENAI_CONFIG_SCHEMA', () => {
  it('declares exactly the two top-level auth methods', () => {
    expect(OCI_GENAI_CONFIG_SCHEMA.authModeField.options).toEqual([
      { value: 'api_key', label: 'Generative AI API Key' },
      { value: 'iam', label: 'OCI IAM' },
    ]);
  });

  it('declares exactly the four IAM subtypes', () => {
    const iamMode = OCI_GENAI_CONFIG_SCHEMA.authModes.find(
      (m) => m.id === 'iam',
    );
    const subtypeField = iamMode!.fields.find((f) => f.id === 'iamAuthMode');
    expect(subtypeField!.options).toEqual([
      { value: 'config_profile', label: 'Config Profile' },
      { value: 'session', label: 'Session' },
      { value: 'instance_principal', label: 'Instance Principal' },
      { value: 'resource_principal', label: 'Resource Principal' },
    ]);
  });
});

describe('getVisibleOciFields', () => {
  it('api_key mode shows Region/Project/Compartment/API Key -- never IAM subtype fields', () => {
    const fields = getVisibleOciFields('api_key');
    const ids = fields.map((f) => f.id);
    expect(ids).toEqual(['region', 'projectId', 'compartmentId', 'credential']);
  });

  it('iam mode with config_profile shows the config path/profile reference fields', () => {
    const fields = getVisibleOciFields('iam', 'config_profile');
    const ids = fields.map((f) => f.id);
    expect(ids).toContain('iamConfigPath');
    expect(ids).toContain('iamConfigProfile');
    expect(ids).not.toContain('credential');
  });

  it('iam mode with session shows the config path/profile reference fields (same as config_profile)', () => {
    const fields = getVisibleOciFields('iam', 'session');
    const ids = fields.map((f) => f.id);
    expect(ids).toContain('iamConfigPath');
    expect(ids).toContain('iamConfigProfile');
  });

  it('iam mode with instance_principal hides config path/profile -- the runtime metadata service owns that identity', () => {
    const fields = getVisibleOciFields('iam', 'instance_principal');
    const ids = fields.map((f) => f.id);
    expect(ids).not.toContain('iamConfigPath');
    expect(ids).not.toContain('iamConfigProfile');
    expect(ids).toEqual([
      'iamAuthMode',
      'region',
      'projectId',
      'compartmentId',
    ]);
  });

  it('iam mode with resource_principal likewise hides config path/profile', () => {
    const fields = getVisibleOciFields('iam', 'resource_principal');
    const ids = fields.map((f) => f.id);
    expect(ids).not.toContain('iamConfigPath');
    expect(ids).not.toContain('iamConfigProfile');
  });

  it('iam mode with no subtype selected yet hides the conditional reference fields (nothing to condition on)', () => {
    const fields = getVisibleOciFields('iam');
    const ids = fields.map((f) => f.id);
    expect(ids).not.toContain('iamConfigPath');
    expect(ids).not.toContain('iamConfigProfile');
  });

  it('never shows the credential (secret) field in IAM mode -- IAM never uses the GenAI API key', () => {
    for (const subtype of [
      'config_profile',
      'session',
      'instance_principal',
      'resource_principal',
    ]) {
      const fields = getVisibleOciFields('iam', subtype);
      expect(fields.map((f) => f.id)).not.toContain('credential');
    }
  });
});

describe('validateOciConfig', () => {
  it('requires region and project OCID regardless of auth mode', () => {
    const errors = validateOciConfig({ authMode: 'api_key' });
    expect(errors.region).toBeTruthy();
    expect(errors.projectId).toBeTruthy();
  });

  it('rejects a structurally-invalid project OCID', () => {
    const errors = validateOciConfig({
      authMode: 'api_key',
      region: 'us-chicago-1',
      projectId: 'not-an-ocid',
      credential: 'k',
    });
    expect(errors.projectId).toBeTruthy();
  });

  it('accepts a structurally-valid project OCID', () => {
    const errors = validateOciConfig({
      authMode: 'api_key',
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      credential: 'k',
    });
    expect(errors.projectId).toBeUndefined();
  });

  it('compartment OCID is optional but validated when present', () => {
    const missing = validateOciConfig({
      authMode: 'api_key',
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      credential: 'k',
    });
    expect(missing.compartmentId).toBeUndefined();

    const invalid = validateOciConfig({
      authMode: 'api_key',
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      compartmentId: 'garbage',
      credential: 'k',
    });
    expect(invalid.compartmentId).toBeTruthy();
  });

  it('api_key mode requires a credential unless one already exists (edit mode)', () => {
    const missingNew = validateOciConfig({
      authMode: 'api_key',
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
    });
    expect(missingNew.credential).toBeTruthy();

    const editModePreserve = validateOciConfig({
      authMode: 'api_key',
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      hasExistingCredential: true,
      // credential left blank -- must be treated as "preserve", not an error
    });
    expect(editModePreserve.credential).toBeUndefined();
  });

  it('iam mode requires a valid iamAuthMode, never requires the credential field', () => {
    const missingSubtype = validateOciConfig({
      authMode: 'iam',
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
    });
    expect(missingSubtype.iamAuthMode).toBeTruthy();
    expect(missingSubtype.credential).toBeUndefined();

    const validSubtype = validateOciConfig({
      authMode: 'iam',
      iamAuthMode: 'instance_principal',
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
    });
    expect(validSubtype.iamAuthMode).toBeUndefined();
  });

  it('rejects no auth mode selected', () => {
    const errors = validateOciConfig({ authMode: '' });
    expect(errors.authMode).toBeTruthy();
  });
});

describe('buildOciSaveOperation', () => {
  it('api_key mode: splits region/project/compartment into safeConfig and the API key into credential', () => {
    const result = buildOciSaveOperation({
      authMode: 'api_key',
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      compartmentId: 'ocid1.compartment.oc1..real',
      credential: 'real-oci-genai-key',
    });
    expect(result.safeConfig).toEqual({
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      compartmentId: 'ocid1.compartment.oc1..real',
    });
    expect(result.credential).toBe('real-oci-genai-key');
    expect(JSON.stringify(result.safeConfig)).not.toContain(
      'real-oci-genai-key',
    );
  });

  it('a blank credential field (edit-mode, preserving the existing secret) produces no credential key in the save operation', () => {
    const result = buildOciSaveOperation({
      authMode: 'api_key',
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      credential: '',
      hasExistingCredential: true,
    });
    expect('credential' in result).toBe(false);
  });

  it('iam config_profile mode: includes iamAuthMode/iamConfigPath/iamConfigProfile in safeConfig, never a credential', () => {
    const result = buildOciSaveOperation({
      authMode: 'iam',
      iamAuthMode: 'config_profile',
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      iamConfigPath: '/custom/.oci/config',
      iamConfigProfile: 'PROD',
    });
    expect(result.safeConfig).toEqual({
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      iamAuthMode: 'config_profile',
      iamConfigPath: '/custom/.oci/config',
      iamConfigProfile: 'PROD',
    });
    expect(result.credential).toBeUndefined();
  });

  it('iam instance_principal mode: never persists config path/profile even if the form retained stale values from a prior subtype', () => {
    const result = buildOciSaveOperation({
      authMode: 'iam',
      iamAuthMode: 'instance_principal',
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      // Simulates leftover form state from switching away from config_profile.
      iamConfigPath: '/stale/leftover/path',
      iamConfigProfile: 'STALE',
    });
    expect(result.safeConfig).toEqual({
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      iamAuthMode: 'instance_principal',
    });
    expect('iamConfigPath' in result.safeConfig).toBe(false);
    expect('iamConfigProfile' in result.safeConfig).toBe(false);
  });

  it('never includes compartmentId in safeConfig when not provided', () => {
    const result = buildOciSaveOperation({
      authMode: 'api_key',
      region: 'us-chicago-1',
      projectId: 'ocid1.generativeaiproject.oc1.us-chicago-1.real',
      credential: 'k',
    });
    expect('compartmentId' in result.safeConfig).toBe(false);
  });
});

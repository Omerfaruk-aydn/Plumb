/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  setProviderConfigResolver,
  resolveProviderSafeConfig,
  resolveProviderConfigValue,
} from './providerConfigResolver.js';

describe('providerConfigResolver', () => {
  afterEach(() => {
    setProviderConfigResolver(undefined);
    delete process.env['TEST_OCI_REGION'];
  });

  it('resolveProviderSafeConfig returns {} when no resolver has been wired', () => {
    expect(resolveProviderSafeConfig('oci-genai')).toEqual({});
  });

  it('resolveProviderConfigValue falls back to the environment variable when no resolver is wired -- legacy env-only behavior unchanged', () => {
    process.env['TEST_OCI_REGION'] = 'eu-frankfurt-1';
    expect(
      resolveProviderConfigValue(
        'oci-genai',
        'region',
        'TEST_OCI_REGION',
        'us-chicago-1',
      ),
    ).toBe('eu-frankfurt-1');
  });

  it('resolveProviderConfigValue falls back to the provided default when neither PLUMB config nor env is set', () => {
    expect(
      resolveProviderConfigValue(
        'oci-genai',
        'region',
        'TEST_OCI_REGION',
        'us-chicago-1',
      ),
    ).toBe('us-chicago-1');
  });

  it('PLUMB-saved configuration takes precedence over the environment variable', () => {
    process.env['TEST_OCI_REGION'] = 'eu-frankfurt-1';
    setProviderConfigResolver((providerId) =>
      providerId === 'oci-genai'
        ? { region: 'ap-mumbai-1' }
        : ({} as Record<string, string>),
    );
    expect(
      resolveProviderConfigValue(
        'oci-genai',
        'region',
        'TEST_OCI_REGION',
        'us-chicago-1',
      ),
    ).toBe('ap-mumbai-1');
  });

  it('an empty/whitespace-only PLUMB config value falls through to env, not treated as a real override', () => {
    process.env['TEST_OCI_REGION'] = 'eu-frankfurt-1';
    setProviderConfigResolver(() => ({ region: '   ' }));
    expect(
      resolveProviderConfigValue(
        'oci-genai',
        'region',
        'TEST_OCI_REGION',
        'us-chicago-1',
      ),
    ).toBe('eu-frankfurt-1');
  });

  it('resolver output is scoped per provider id -- no cross-provider config bleed', () => {
    setProviderConfigResolver((providerId) =>
      providerId === 'oci-genai'
        ? { region: 'ap-mumbai-1' }
        : ({} as Record<string, string>),
    );
    expect(
      resolveProviderConfigValue('watsonx', 'region', 'TEST_OCI_REGION'),
    ).toBeUndefined();
  });

  it('a throwing resolver is treated as "not configured" -- never breaks catalog resolution', () => {
    setProviderConfigResolver(() => {
      throw new Error('boom');
    });
    expect(resolveProviderSafeConfig('oci-genai')).toEqual({});
    expect(
      resolveProviderConfigValue(
        'oci-genai',
        'region',
        'TEST_OCI_REGION',
        'us-chicago-1',
      ),
    ).toBe('us-chicago-1');
  });
});

/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * OCI IAM auth-provider resolution: each of the four supported modes must
 * construct the correct real `oci-common` provider type (never a
 * hand-rolled signer), read only safe config references from env (never a
 * private key/session token value), cache correctly, and invalidate the
 * cache when mode/config path/profile changes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockConfigFileCtor = vi.fn();
const mockSessionAuthCtor = vi.fn();
const mockInstancePrincipalsBuild = vi.fn();
const mockResourcePrincipalBuilder = vi.fn();
const mockSignHttpRequest = vi.fn();
const mockDefaultRequestSignerCtor = vi.fn();

vi.mock('oci-common', () => ({
  ConfigFileAuthenticationDetailsProvider: class {
    constructor(...args: unknown[]) {
      mockConfigFileCtor(...args);
    }
  },
  SessionAuthDetailProvider: class {
    constructor(...args: unknown[]) {
      mockSessionAuthCtor(...args);
    }
  },
  InstancePrincipalsAuthenticationDetailsProviderBuilder: class {
    build() {
      return mockInstancePrincipalsBuild();
    }
  },
  ResourcePrincipalAuthenticationDetailsProvider: {
    builder: () => mockResourcePrincipalBuilder(),
  },
  DefaultRequestSigner: class {
    constructor(...args: unknown[]) {
      mockDefaultRequestSignerCtor(...args);
    }
    signHttpRequest(...args: unknown[]) {
      return mockSignHttpRequest(...args);
    }
  },
}));

async function importFresh() {
  vi.resetModules();
  const mod = await import('./ociGenaiIamAuth.js');
  mod.__resetOciIamProviderCacheForTests();
  return mod;
}

describe('resolveOciIamAuthMode', () => {
  afterEach(() => {
    delete process.env['OCI_IAM_AUTH_MODE'];
  });

  it('a PLUMB-saved auth mode (via the config resolver) takes precedence over OCI_IAM_AUTH_MODE -- the UI-driven save path actually works', async () => {
    process.env['OCI_IAM_AUTH_MODE'] = 'session';
    // vi.resetModules() (inside importFresh) clears the whole module
    // registry, so the resolver must be set on the SAME fresh instance of
    // providerConfigResolver.js that ociGenaiIamAuth.js will import --
    // setting it on a pre-reset module instance would silently no-op.
    vi.resetModules();
    const resolverMod = await import('../config/providerConfigResolver.js');
    resolverMod.setProviderConfigResolver((providerId) =>
      providerId === 'oci-genai'
        ? ({ iamAuthMode: 'instance_principal' } as Record<string, string>)
        : ({} as Record<string, string>),
    );
    const mod = await import('./ociGenaiIamAuth.js');
    mod.__resetOciIamProviderCacheForTests();
    expect(mod.resolveOciIamAuthMode()).toBe('instance_principal');
  });

  it('returns undefined when unset', async () => {
    const mod = await importFresh();
    expect(mod.resolveOciIamAuthMode()).toBeUndefined();
  });

  it('returns undefined for an invalid mode rather than guessing a fallback', async () => {
    process.env['OCI_IAM_AUTH_MODE'] = 'not_a_real_mode';
    const mod = await importFresh();
    expect(mod.resolveOciIamAuthMode()).toBeUndefined();
  });

  it.each([
    'config_profile',
    'session',
    'instance_principal',
    'resource_principal',
  ])('returns %s when explicitly set', async (mode) => {
    process.env['OCI_IAM_AUTH_MODE'] = mode;
    const mod = await importFresh();
    expect(mod.resolveOciIamAuthMode()).toBe(mode);
  });
});

describe('getOciIamAuthProvider', () => {
  afterEach(() => {
    vi.resetAllMocks();
    delete process.env['OCI_IAM_CONFIG_PATH'];
    delete process.env['OCI_IAM_CONFIG_PROFILE'];
  });

  it('config_profile constructs ConfigFileAuthenticationDetailsProvider with the configured path/profile -- never a hand-rolled signer', async () => {
    process.env['OCI_IAM_CONFIG_PATH'] = '/custom/.oci/config';
    process.env['OCI_IAM_CONFIG_PROFILE'] = 'PROD';
    mockConfigFileCtor.mockReturnValue(undefined);
    const mod = await importFresh();
    await mod.getOciIamAuthProvider('config_profile');
    expect(mockConfigFileCtor).toHaveBeenCalledWith(
      '/custom/.oci/config',
      'PROD',
    );
    expect(mockSessionAuthCtor).not.toHaveBeenCalled();
    expect(mockInstancePrincipalsBuild).not.toHaveBeenCalled();
    expect(mockResourcePrincipalBuilder).not.toHaveBeenCalled();
  });

  it('session constructs SessionAuthDetailProvider (never confused with config_profile)', async () => {
    const mod = await importFresh();
    await mod.getOciIamAuthProvider('session');
    expect(mockSessionAuthCtor).toHaveBeenCalledWith(undefined, undefined);
    expect(mockConfigFileCtor).not.toHaveBeenCalled();
  });

  it("instance_principal uses the builder's async .build() -- no local config read at all", async () => {
    mockInstancePrincipalsBuild.mockResolvedValue({ kind: 'instance' });
    const mod = await importFresh();
    const provider = await mod.getOciIamAuthProvider('instance_principal');
    expect(provider).toEqual({ kind: 'instance' });
    expect(mockConfigFileCtor).not.toHaveBeenCalled();
    expect(mockSessionAuthCtor).not.toHaveBeenCalled();
  });

  it('resource_principal uses the static synchronous .builder() -- no local config read at all', async () => {
    mockResourcePrincipalBuilder.mockReturnValue({ kind: 'resource' });
    const mod = await importFresh();
    const provider = await mod.getOciIamAuthProvider('resource_principal');
    expect(provider).toEqual({ kind: 'resource' });
    expect(mockConfigFileCtor).not.toHaveBeenCalled();
    expect(mockInstancePrincipalsBuild).not.toHaveBeenCalled();
  });

  it('caches the provider for the same (mode, configPath, profile) -- does not reconstruct on every call', async () => {
    const mod = await importFresh();
    const first = await mod.getOciIamAuthProvider('config_profile');
    const second = await mod.getOciIamAuthProvider('config_profile');
    expect(first).toBe(second);
    expect(mockConfigFileCtor).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cache when the mode changes', async () => {
    mockInstancePrincipalsBuild.mockResolvedValue({ kind: 'instance' });
    const mod = await importFresh();
    await mod.getOciIamAuthProvider('config_profile');
    await mod.getOciIamAuthProvider('instance_principal');
    expect(mockConfigFileCtor).toHaveBeenCalledTimes(1);
    expect(mockInstancePrincipalsBuild).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cache when the config profile changes -- no stale profile bleed between switches', async () => {
    const mod = await importFresh();
    process.env['OCI_IAM_CONFIG_PROFILE'] = 'DEV';
    await mod.getOciIamAuthProvider('config_profile');
    process.env['OCI_IAM_CONFIG_PROFILE'] = 'PROD';
    await mod.getOciIamAuthProvider('config_profile');
    expect(mockConfigFileCtor).toHaveBeenCalledTimes(2);
    expect(mockConfigFileCtor).toHaveBeenNthCalledWith(1, undefined, 'DEV');
    expect(mockConfigFileCtor).toHaveBeenNthCalledWith(2, undefined, 'PROD');
  });
});

describe('signOciGenaiRequest', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('signs the final request in place via DefaultRequestSigner -- never a second signing implementation', async () => {
    const mod = await importFresh();
    const provider = { fake: 'provider' } as never;
    const headers = new Headers({
      'Content-Type': 'application/json',
      'opc-compartment-id': 'ocid1.compartment.oc1..real',
    });
    await mod.signOciGenaiRequest(provider, {
      method: 'POST',
      url: 'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/openai/v1/responses',
      headers,
      body: '{"model":"openai.gpt-oss-120b"}',
    });

    expect(mockDefaultRequestSignerCtor).toHaveBeenCalledWith(provider);
    expect(mockSignHttpRequest).toHaveBeenCalledTimes(1);
    const [signedRequest] = mockSignHttpRequest.mock.calls[0] as [
      { method: string; uri: string; headers: Headers; body?: string },
    ];
    expect(signedRequest.method).toBe('POST');
    expect(signedRequest.uri).toBe(
      'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/openai/v1/responses',
    );
    expect(signedRequest.headers).toBe(headers);
    expect(signedRequest.body).toBe('{"model":"openai.gpt-oss-120b"}');
  });
});

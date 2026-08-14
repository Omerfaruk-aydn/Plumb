/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getPlumbProvider } from './providers.js';

function authMethodTypes(id: string): string[] {
  return (getPlumbProvider(id)?.authMethods ?? []).map((m) => m.type);
}

describe('coding-plan catalog presentation', () => {
  it('github-copilot is a device_code flow (not paste-code OAuth)', () => {
    const provider = getPlumbProvider('github-copilot');
    expect(provider?.available).toBe(true);
    expect(authMethodTypes('github-copilot')).toContain('device_code');
    expect(authMethodTypes('github-copilot')).not.toContain('oauth');
  });

  it('kimi-code is a device_code flow (not paste-code OAuth)', () => {
    const provider = getPlumbProvider('kimi-code');
    expect(provider?.available).toBe(true);
    expect(authMethodTypes('kimi-code')).toContain('device_code');
    expect(authMethodTypes('kimi-code')).not.toContain('oauth');
  });

  it('opencode-go and opencode-zen are api_key paste flows (not OAuth)', () => {
    for (const id of ['opencode-go', 'opencode-zen']) {
      const provider = getPlumbProvider(id);
      expect(provider?.available, `${id} must be selectable`).toBe(true);
      expect(authMethodTypes(id)).toContain('api_key');
      expect(authMethodTypes(id)).not.toContain('oauth');
    }
  });

  it('antigravity OAuth callback uses the OMP port 51121', () => {
    const provider = getPlumbProvider('antigravity');
    expect(provider?.available).toBe(true);
    const oauth = provider?.authMethods.find((m) => m.type === 'oauth');
    expect(oauth).toBeDefined();
    if (oauth && oauth.type === 'oauth') {
      expect(oauth.port).toBe(51121);
    }
  });

  it('antigravity resolves to the canonical OMP id google-antigravity', async () => {
    const { resolveProviderAlias } = await import('./providers.js');
    expect(resolveProviderAlias('antigravity')).toBe('google-antigravity');
  });

  it('resolvePlumbProviderId reverses the alias back to the PLUMB registry id', async () => {
    const { resolvePlumbProviderId } = await import('./providers.js');
    expect(resolvePlumbProviderId('google-antigravity')).toBe('antigravity');
    // Already-PLUMB / non-aliased ids pass through unchanged.
    expect(resolvePlumbProviderId('antigravity')).toBe('antigravity');
    expect(resolvePlumbProviderId('github-copilot')).toBe('github-copilot');
    expect(resolvePlumbProviderId('nvidia')).toBe('nvidia');
  });

  it('resolveProviderAlias and resolvePlumbProviderId round-trip for every aliased provider', async () => {
    const { resolveProviderAlias, resolvePlumbProviderId } = await import(
      './providers.js'
    );
    for (const plumbId of ['antigravity', 'llama-cpp', 'anthropic-api']) {
      const ompId = resolveProviderAlias(plumbId);
      expect(resolvePlumbProviderId(ompId)).toBe(plumbId);
    }
  });
});

/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Coding-plan catalog presentation contract.
 *
 * The four broken coding-plan auth flows must be truthfully presented:
 * - github-copilot and kimi-code authenticate via the device-code flow, not a
 *   paste-code browser OAuth exchange;
 * - opencode-go / opencode-zen are API-key paste flows, not OAuth;
 * - antigravity's OAuth callback runs on the OMP-registered port 51121.
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
});

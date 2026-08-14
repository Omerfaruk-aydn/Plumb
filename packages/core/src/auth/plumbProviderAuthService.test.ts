/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlumbProviderAuthService } from './plumbProviderAuthService.js';
import {
  getPlumbProvider,
  PlumbProviderCategory,
  registerPlumbCredentialStoreFactory,
  resetPlumbCredentialStore,
} from '@plumb/provider';
import { OmpAuthSchemaKeychainAdapter } from './omp-credential-adapter.js';

describe('coding-plan auth routing', () => {
  beforeAll(async () => {
    // Provider registry.initialize() resolves the credential store; register
    // the OS-keychain-backed adapter (file-fallback in CI) like production.
    registerPlumbCredentialStoreFactory(() =>
      Promise.resolve(new OmpAuthSchemaKeychainAdapter()),
    );
    const { getPlumbProviderRegistry } = await import('@plumb/provider');
    await getPlumbProviderRegistry().initialize();
  });

  afterAll(() => {
    resetPlumbCredentialStore();
  });

  it('classifies the four previously-broken plans as coding plans', () => {
    for (const id of [
      'github-copilot',
      'kimi-code',
      'opencode-go',
      'antigravity',
    ]) {
      const provider = getPlumbProvider(id);
      expect(provider, `${id} must be a cataloged provider`).toBeDefined();
      expect(provider?.category).toBe(PlumbProviderCategory.CODING_PLAN);
    }
  });

  it('no longer reports "No auth flow configured" for coding plans (OMP login present)', async () => {
    const { getProviderDefinition, resolveProviderAlias } = await import(
      '@plumb/provider'
    );
    for (const id of ['github-copilot', 'kimi-code', 'antigravity']) {
      const ompId = resolveProviderAlias(id);
      const def = getProviderDefinition(ompId);
      expect(
        typeof def?.login === 'function',
        `${id} (OMP ${ompId}) must expose an OMP login function`,
      ).toBe(true);
    }
    // opencode-go is an API-key paste flow — it must resolve through the
    // dialog's API-key path (no interactive login needed).
    const ompId = resolveProviderAlias('opencode-go');
    const def = getProviderDefinition(ompId);
    expect(typeof def?.login === 'function').toBe(true);
  });

  it('routes coding-plan logins through the OMP login (Alibaba needs typed input → clear error, no network)', async () => {
    const service = new PlumbProviderAuthService();
    const result = await service.beginLogin('alibaba-coding-plan');
    // The OMP login for alibaba requires a typed endpoint choice; with no
    // interactive onPrompt channel the flow must fail with an actionable
    // message instead of "No auth flow configured" or a network call.
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('alibaba-coding-plan');
  });
});

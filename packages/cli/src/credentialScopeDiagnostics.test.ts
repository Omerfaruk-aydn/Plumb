/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Proves `plumb --diagnose-credential-scope <provider>` proves (rather than
 * assumes) which literal string a provider's credential is actually stored
 * under, probing both the PLUMB presentation id and the OMP catalog id
 * directly against the real secure store — without ever printing a secret
 * or modifying the store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockStoreGetCredentials = vi.fn();
const mockStoreGetProviderMetadata = vi.fn();

vi.mock('@google/gemini-cli-core', () => ({
  initializePlumbProviders: vi.fn().mockResolvedValue(undefined),
  getPlumbCredentialStore: () => ({
    getCredentials: mockStoreGetCredentials,
    getProviderMetadata: mockStoreGetProviderMetadata,
  }),
}));

vi.mock('@google/gemini-cli-provider', () => ({
  installBunGlobal: vi.fn(),
  registerPlumbCredentialStoreFactory: vi.fn(),
  initBundledModels: vi.fn(),
  getPlumbProviderRegistry: () => ({ initialize: vi.fn() }),
  resolveProviderAlias: (id: string) =>
    id === 'antigravity' ? 'google-antigravity' : id,
  resolvePlumbProviderId: (id: string) =>
    id === 'google-antigravity' ? 'antigravity' : id,
}));

const validCredential = {
  type: 'oauth' as const,
  provider: 'antigravity',
  access: 'ya29.never-printed',
  refresh: 'refresh-never-printed',
  expires: Date.now() + 3_600_000,
  projectId: 'project-never-printed',
};

function emptyMetadata() {
  return { accountLabels: [], credentialRefs: [] };
}

describe('printCredentialScopeDiagnostics (--diagnose-credential-scope)', () => {
  let logs: string[];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    logs = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies NO_CREDENTIAL when neither candidate scope has an entry', async () => {
    mockStoreGetCredentials.mockResolvedValue([]);
    mockStoreGetProviderMetadata.mockResolvedValue(emptyMetadata());

    const { printCredentialScopeDiagnostics } = await import(
      './runtimeDiagnostics.js'
    );
    const code = await printCredentialScopeDiagnostics('antigravity');
    const output = logs.join('');

    expect(code).toBe(0);
    expect(output).toContain('requested.provider: antigravity');
    expect(output).toContain('canonical.catalog.provider: google-antigravity');
    expect(output).toContain('candidateScope.antigravity.present: false');
    expect(output).toContain(
      'candidateScope.google-antigravity.present: false',
    );
    expect(output).toContain('resolved.scope: (none)');
    expect(output).toContain('credential.classification: NO_CREDENTIAL');
  });

  it('resolves the credential under the PLUMB presentation-id scope, not the OMP catalog id', async () => {
    // The real, proven write scope for Antigravity is the PLUMB id
    // ("antigravity"); the OMP catalog id ("google-antigravity") must
    // report as absent — proving write/read scope match, not assumed.
    mockStoreGetCredentials.mockImplementation(async (scope: string) =>
      scope === 'antigravity'
        ? [
            {
              provider: 'antigravity',
              credential: validCredential,
              source: 'oauth',
            },
          ]
        : [],
    );
    mockStoreGetProviderMetadata.mockImplementation(async (scope: string) =>
      scope === 'antigravity'
        ? { accountLabels: [], credentialRefs: ['plumb:cred:antigravity:x'] }
        : emptyMetadata(),
    );

    const { printCredentialScopeDiagnostics } = await import(
      './runtimeDiagnostics.js'
    );
    await printCredentialScopeDiagnostics('antigravity');
    const output = logs.join('');

    expect(output).toContain('candidateScope.antigravity.present: true');
    expect(output).toContain(
      'candidateScope.google-antigravity.present: false',
    );
    expect(output).toContain('resolved.scope: antigravity');
    expect(output).toContain('credential.classification: VALID_CREDENTIAL');
    expect(output).toContain('credential.kind: oauth');
    expect(output).toContain('credential.accessToken.present: true');
    expect(output).toContain('credential.refreshToken.present: true');
    expect(output).toContain('credential.projectId.present: true');
    expect(output).toContain('credential.expired: false');
  });

  it('classifies an expired credential as EXPIRED_REFRESHABLE, not NO_CREDENTIAL', async () => {
    const expired = { ...validCredential, expires: Date.now() - 1_000 };
    mockStoreGetCredentials.mockResolvedValue([
      { provider: 'antigravity', credential: expired, source: 'oauth' },
    ]);
    mockStoreGetProviderMetadata.mockResolvedValue({
      accountLabels: [],
      credentialRefs: ['plumb:cred:antigravity:x'],
    });

    const { printCredentialScopeDiagnostics } = await import(
      './runtimeDiagnostics.js'
    );
    await printCredentialScopeDiagnostics('antigravity');
    const output = logs.join('');

    expect(output).toContain('credential.expired: true');
    expect(output).toContain('credential.refreshToken.present: true');
    expect(output).toContain('credential.classification: EXPIRED_REFRESHABLE');
  });

  it('classifies an expired credential with no refresh token as EXPIRED_UNREFRESHABLE', async () => {
    const expired = {
      ...validCredential,
      expires: Date.now() - 1_000,
      refresh: '',
    };
    mockStoreGetCredentials.mockResolvedValue([
      { provider: 'antigravity', credential: expired, source: 'oauth' },
    ]);
    mockStoreGetProviderMetadata.mockResolvedValue({
      accountLabels: [],
      credentialRefs: ['plumb:cred:antigravity:x'],
    });

    const { printCredentialScopeDiagnostics } = await import(
      './runtimeDiagnostics.js'
    );
    await printCredentialScopeDiagnostics('antigravity');
    const output = logs.join('');

    expect(output).toContain('credential.refreshToken.present: false');
    expect(output).toContain(
      'credential.classification: EXPIRED_UNREFRESHABLE',
    );
  });

  it('classifies a metadata entry that fails to decode as INVALID_STORED_SHAPE', async () => {
    // Metadata references a credential ref, but the keychain read/decode
    // returned zero usable entries — a real corruption signal, distinct
    // from "never signed in".
    mockStoreGetCredentials.mockResolvedValue([]);
    mockStoreGetProviderMetadata.mockResolvedValue({
      accountLabels: [],
      credentialRefs: ['plumb:cred:antigravity:corrupted'],
    });

    const { printCredentialScopeDiagnostics } = await import(
      './runtimeDiagnostics.js'
    );
    await printCredentialScopeDiagnostics('antigravity');
    const output = logs.join('');

    expect(output).toContain('credential.classification: INVALID_STORED_SHAPE');
  });

  it('never prints the access token, refresh token, or project id value', async () => {
    mockStoreGetCredentials.mockResolvedValue([
      { provider: 'antigravity', credential: validCredential, source: 'oauth' },
    ]);
    mockStoreGetProviderMetadata.mockResolvedValue({
      accountLabels: [],
      credentialRefs: ['plumb:cred:antigravity:x'],
    });

    const { printCredentialScopeDiagnostics } = await import(
      './runtimeDiagnostics.js'
    );
    await printCredentialScopeDiagnostics('antigravity');
    const output = logs.join('');

    expect(output).not.toContain('ya29.never-printed');
    expect(output).not.toContain('refresh-never-printed');
    expect(output).not.toContain('project-never-printed');
  });

  it('never calls a store mutation method (removeCredentials/storeCredential/clearAll)', async () => {
    mockStoreGetCredentials.mockResolvedValue([
      { provider: 'antigravity', credential: validCredential, source: 'oauth' },
    ]);
    mockStoreGetProviderMetadata.mockResolvedValue({
      accountLabels: [],
      credentialRefs: ['plumb:cred:antigravity:x'],
    });
    const { printCredentialScopeDiagnostics } = await import(
      './runtimeDiagnostics.js'
    );
    await printCredentialScopeDiagnostics('antigravity');
    // The mocked store object only exposes getCredentials/getProviderMetadata
    // — if the diagnostic ever called a mutation method it would throw
    // "is not a function", which would surface as a printed failure line.
    const output = logs.join('');
    expect(output).not.toMatch(/FAIL/);
  });
});

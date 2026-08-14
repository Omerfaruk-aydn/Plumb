/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getPlumbCredentialStore } from '@plumb/core';
import { resetPlumbProviderRegistry } from '@plumb/provider';
import {
  buildAntigravityRouteDiagnostics,
  runAntigravityRouteTest,
} from './runtimeDiagnostics.js';

let isolatedHome: string;
let previousHome: string | undefined;

vi.mock('./config/settings.js', () => ({
  loadSettings: () => ({
    merged: {
      plumb: { provider: { id: 'antigravity' } },
      model: { name: 'gpt-oss-120b-medium' },
    },
  }),
}));

describe('Antigravity diagnostics — production bootstrap lifecycle', () => {
  beforeEach(() => {
    isolatedHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'plumb-antigravity-diag-bootstrap-'),
    );
    previousHome = process.env['PLUMB_CLI_HOME'];
    process.env['PLUMB_CLI_HOME'] = isolatedHome;
    resetPlumbProviderRegistry();
  });

  afterEach(() => {
    resetPlumbProviderRegistry();
    if (previousHome === undefined) {
      delete process.env['PLUMB_CLI_HOME'];
    } else {
      process.env['PLUMB_CLI_HOME'] = previousHome;
    }
    fs.rmSync(isolatedHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('reaches a credential-store-configured, then credential-present, real fetch boundary purely via the diagnostics own bootstrap', async () => {
    // ── Phase 1: no credential stored yet ────────────────────────────
    // Proves the diagnostic's OWN call to initializePlumbProviders (not a
    // manual registerPlumbCredentialStoreFactory in this test) is what
    // gets the credential store configured. Without it this throws
    // "PlumbCredentialStore not configured."
    const first = await buildAntigravityRouteDiagnostics();
    const firstOutput = first.lines.join('\n');
    expect(firstOutput).toContain('runtime.initialized: true');
    expect(firstOutput).toContain('credential.store.configured: true');
    expect(firstOutput).toContain('credential.present: false');
    expect(first.failures).toEqual([
      'No credential available for provider: antigravity (NO_CREDENTIAL). Sign in again via /login antigravity.',
    ]);

    // ── Phase 2: persist a real credential, then probe live ──────────
    // Arranged through the REAL credential store (legitimate test setup),
    // not by re-registering the credential store factory.
    resetPlumbProviderRegistry();
    const store = getPlumbCredentialStore();
    await store.storeOAuthCredential('antigravity', {
      type: 'oauth',
      provider: 'antigravity',
      access: 'ya29.integration-test-token',
      refresh: 'refresh-token',
      expires: Date.now() + 3_600_000,
      projectId: 'integration-test-project',
    });

    let fetchCalled = false;
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      fetchCalled = true;
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response('data: {"response":{"candidates":[]}}\n\n', {
        status: 200,
      });
    }) as typeof fetch;

    const logs: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await runAntigravityRouteTest('gpt-oss-120b-medium');

    const output = logs.join('');
    expect(output).toContain('runtime.initialized: true');
    expect(output).toContain('credential.store.configured: true');
    expect(output).toContain('credential.present: true');
    expect(output).toContain('request.attempted: true');
    expect(fetchCalled).toBe(true);
    expect(capturedHeaders?.['Authorization']).toBe(
      'Bearer ya29.integration-test-token',
    );
    expect(code).toBe(0);
    expect(output).toContain('HTTP.status: 200');
    // Never printed: the real access token used only in the Authorization
    // header sent to fetch, never in diagnostic stdout output.
    expect(output).not.toContain('ya29.integration-test-token');
  }, 20_000);
});

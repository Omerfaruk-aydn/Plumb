/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production-shaped regression for the live-observed Antigravity acceptance
 * failure:
 *
 *   real OAuth login succeeded ("Authentication successful.")
 *   -> credential held only in runtime memory by the harness
 *   -> immediate REAL production stream (plumbModelStream ->
 *      googleCloudCodeAssistStream -> buildAntigravityRequest ->
 *      resolveUsablePlumbCredential('antigravity')) reported
 *      "No credential available for provider: antigravity (NO_CREDENTIAL)"
 *
 * because the harness never adopted the completed login into the canonical
 * credential authority (secure store + provider registry) the way /login
 * does. This test runs the REAL end-to-end chain:
 *
 *   initializePlumbProviders (the same bootstrap gemini.tsx runs before
 *   --test-provider) -> REAL provider module (only the OMP device-OAuth
 *   login function is stubbed — no real browser/network in tests) ->
 *   runCodingPlanLiveAcceptance -> adoptPlumbLoginResult ->
 *   REAL store/registry/resolver/request-builder -> fetch (stubbed SSE)
 *
 * It fails against the broken behavior (no adoption -> MISSING_CREDENTIAL
 * -> LIVE_TEST_FAILED) and passes once the adoption leg exists.
 *
 * Never prints tokens, refresh tokens, project ids, or auth headers.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initializePlumbProviders,
  getPlumbCredentialStore,
} from '@google/gemini-cli-core';
import {
  installBunGlobal,
  resetPlumbProviderRegistry,
  resolveUsablePlumbCredential,
  getProviderDefinition,
} from '@google/gemini-cli-provider';
import { runCodingPlanLiveAcceptance } from './providerAcceptanceHarness.js';

const ACCESS = 'ya29.live-acceptance-access';
const REFRESH = 'live-acceptance-refresh';
const PROJECT = 'live-acceptance-gcp-project';

const SSE_BODY =
  'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"PLUMB_TEST_OK"}]}}]}}\n\n' +
  'data: {"response":{"candidates":[{"content":{"role":"model","parts":[]},"finishReason":"STOP"}]}}\n\n';

function makeLoginDef() {
  const realDef = getProviderDefinition('google-antigravity');
  expect(realDef).toBeDefined();
  return {
    ...realDef,
    login: async () => ({
      access: ACCESS,
      refresh: REFRESH,
      expires: Date.now() + 3_600_000,
      projectId: PROJECT,
    }),
  };
}

async function makeProviderModule(
  loginDef: Record<string, unknown>,
  dropAdoption = false,
) {
  const realModule = (await import(
    '@google/gemini-cli-provider'
  )) as unknown as Record<string, unknown>;
  const base = dropAdoption
    ? Object.fromEntries(
        Object.entries(realModule).filter(
          ([k]) => k !== 'adoptPlumbLoginResult',
        ),
      )
    : realModule;
  return {
    ...base,
    getProviderDefinition: (id: string) =>
      id === 'google-antigravity' ? loginDef : getProviderDefinition(id),
  };
}
describe('antigravity live auth -> production stream credential handoff (production-shaped)', () => {
  let isolatedHome: string;
  let previousHome: string | undefined;
  let previousForceFileStorage: string | undefined;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    isolatedHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'plumb-antigravity-acceptance-'),
    );
    previousHome = process.env['GEMINI_CLI_HOME'];
    previousForceFileStorage = process.env['GEMINI_FORCE_FILE_STORAGE'];
    process.env['GEMINI_CLI_HOME'] = isolatedHome;
    // Keep the test hermetic: encrypted file keychain under the isolated
    // home, never the real OS credential manager.
    process.env['GEMINI_FORCE_FILE_STORAGE'] = 'true';
    resetPlumbProviderRegistry();
    await initializePlumbProviders();
    installBunGlobal();
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    try {
      await getPlumbCredentialStore().removeCredentials('antigravity');
    } catch {
      // best-effort cleanup of the isolated store
    }
    resetPlumbProviderRegistry();
    if (previousHome === undefined) {
      delete process.env['GEMINI_CLI_HOME'];
    } else {
      process.env['GEMINI_CLI_HOME'] = previousHome;
    }
    if (previousForceFileStorage === undefined) {
      delete process.env['GEMINI_FORCE_FILE_STORAGE'];
    } else {
      process.env['GEMINI_FORCE_FILE_STORAGE'] = previousForceFileStorage;
    }
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  });
  it('adopts the completed login into the canonical store, so the immediate real production stream is LIVE_VERIFIED', async () => {
    // Precondition — the exact live pre-auth state: store configured (the
    // bootstrap above registered it) but empty for this provider.
    const before = await resolveUsablePlumbCredential('antigravity');
    expect(before.classification).toBe('NO_CREDENTIAL');

    const loginDef = makeLoginDef();
    const providerModule = await makeProviderModule(
      loginDef as unknown as Record<string, unknown>,
    );

    let capturedUrl: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(SSE_BODY, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;

    const terminalLines: string[] = [];
    const reportLines: string[] = [];
    const exitCode = await runCodingPlanLiveAcceptance(
      'antigravity',
      'google-antigravity',
      providerModule as unknown as Record<string, unknown>,
      loginDef as unknown as Record<string, unknown>,
      'coding_plan',
      {
        terminal: { writeLine: (line) => terminalLines.push(line) },
        report: (line) => reportLines.push(line),
        modelInput: async () => ({ type: 'number', value: 1 }),
      },
    );

    const report = reportLines.join('\n');
    expect(exitCode).toBe(0);
    expect(report).toContain('provider.id: antigravity');
    expect(report).toContain('auth.result: verified');
    expect(report).toContain('credential.provider: antigravity');
    expect(report).toContain('transport.dialect: google-gemini-cli');
    expect(report).toContain('stream.started: true');
    expect(report).toContain('stream.completed: true');
    expect(report).toContain('result: LIVE_VERIFIED');

    // The REAL production request went to the pinned Cloud Code Assist
    // endpoint with the adopted credential — resolved via the store, not
    // via the transient apiKey handle.
    expect(capturedUrl).toBe(
      'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
    );
    expect(capturedHeaders?.['Authorization']).toBe(`Bearer ${ACCESS}`);
    expect(capturedHeaders?.['User-Agent']).toContain('antigravity');

    // The adoption persists for the rest of the runtime: the same usable
    // credential authority normal chat, /login antigravity, and
    // --test-antigravity-route all resolve.
    const after = await resolveUsablePlumbCredential('antigravity');
    expect(after.classification).toBe('VALID_CREDENTIAL');
    expect(after.credential?.projectId).toBe(PROJECT);
    // Scope discipline: the OMP catalog id was never used as a store key.
    expect(
      await getPlumbCredentialStore().getCredentials('google-antigravity'),
    ).toEqual([]);

    // No secret material in any live or report line.
    const allOutput = [...terminalLines, ...reportLines].join('\n');
    expect(allOutput).not.toContain(ACCESS);
    expect(allOutput).not.toContain(REFRESH);
    expect(allOutput).not.toContain(PROJECT);
  }, 30_000);
  it('fails closed (honest LIVE_TEST_FAILED, no fabricated success) when the provider module lacks the canonical adoption seam', async () => {
    const loginDef = makeLoginDef();
    const providerModule = await makeProviderModule(
      loginDef as unknown as Record<string, unknown>,
      true,
    );

    const reportLines: string[] = [];
    const exitCode = await runCodingPlanLiveAcceptance(
      'antigravity',
      'google-antigravity',
      providerModule as unknown as Record<string, unknown>,
      loginDef as unknown as Record<string, unknown>,
      'coding_plan',
      {
        terminal: { writeLine: () => {} },
        report: (line) => reportLines.push(line),
        modelInput: async () => ({ type: 'number', value: 1 }),
      },
    );

    const report = reportLines.join('\n');
    expect(exitCode).toBe(1);
    expect(report).toContain('result: LIVE_TEST_FAILED');
    expect(report).toContain('adoptPlumbLoginResult');
    expect(report).not.toContain(ACCESS);
  }, 30_000);
});


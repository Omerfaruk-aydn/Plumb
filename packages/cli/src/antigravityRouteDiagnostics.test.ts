/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Proves the `--diagnose-antigravity-route` / `--test-antigravity-route`
 * diagnostics call the exact same production request-builder normal chat
 * uses (buildAntigravityRequest, exported from @google/gemini-cli-provider),
 * and that neither diagnostic ever prints a secret.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetProviderState = vi.fn();
const mockFindModel = vi.fn();
const mockBuildAntigravityRequest = vi.fn();
const mockInitialize = vi.fn().mockResolvedValue(undefined);

vi.mock('@google/gemini-cli-provider', () => ({
  installBunGlobal: vi.fn(),
  registerPlumbCredentialStoreFactory: vi.fn(),
  initBundledModels: vi.fn(),
  getPlumbProviderRegistry: () => ({
    initialize: mockInitialize,
    getProviderState: mockGetProviderState,
  }),
  getPlumbModelRegistry: () => ({
    findModel: mockFindModel,
  }),
  buildAntigravityRequest: mockBuildAntigravityRequest,
  // Real resolver behavior — mirrors packages/provider/src/catalog/providers.ts.
  resolveProviderAlias: (id: string) =>
    id === 'antigravity' ? 'google-antigravity' : id,
  // OMP id `google-antigravity` -> PLUMB registry id `antigravity` (the id
  // PlumbProviderRegistry state is actually keyed by).
  resolvePlumbProviderId: (id: string) =>
    id === 'google-antigravity' ? 'antigravity' : id,
}));

vi.mock('@google/gemini-cli-core', () => ({
  initializePlumbProviders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./config/settings.js', () => ({
  loadSettings: () => ({
    merged: {
      plumb: { provider: { id: 'google-antigravity' } },
      model: { name: 'gpt-oss-120b-medium' },
    },
  }),
}));

const validCredential = {
  type: 'oauth' as const,
  provider: 'google-antigravity',
  access: 'ya29.real-token-never-printed',
  refresh: 'refresh',
  expires: Date.now() + 3_600_000,
  projectId: 'real-project-never-printed',
};

const antigravityModel = {
  id: 'gpt-oss-120b',
  requestModelId: 'gpt-oss-120b-medium',
  provider: 'google-antigravity',
  api: 'google-gemini-cli' as const,
  contextWindow: 128_000,
  maxTokens: 8_192,
  reasoning: false,
  input: 'text' as const,
};

const realDescriptor = {
  url: 'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
  headers: {
    Authorization: 'Bearer ya29.real-token-never-printed',
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'User-Agent': 'antigravity',
  },
  body: {
    project: 'real-project-never-printed',
    model: 'gpt-oss-120b-medium',
    requestId: 'agent/abc/1234567890/def/2',
    userAgent: 'antigravity',
    requestType: 'agent',
    request: {
      contents: [
        { role: 'user', parts: [{ text: '(diagnostic — not sent)' }] },
      ],
      sessionId: '123',
      labels: {},
    },
  },
};

describe('printAntigravityRouteDiagnostics (--diagnose-antigravity-route)', () => {
  let logs: string[];
  let errs: string[];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    logs = [];
    errs = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      errs.push(String(chunk));
      return true;
    });
    mockInitialize.mockResolvedValue(undefined);
    mockGetProviderState.mockReturnValue({ credentials: validCredential });
    mockFindModel.mockReturnValue(antigravityModel);
    mockBuildAntigravityRequest.mockResolvedValue({
      ok: true,
      descriptor: realDescriptor,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never sends a network request', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    try {
      const { printAntigravityRouteDiagnostics } = await import(
        './runtimeDiagnostics.js'
      );
      await printAntigravityRouteDiagnostics();
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalled).toBe(false);
  }, 15_000);

  it('calls the exact production buildAntigravityRequest export — same function normal chat uses', async () => {
    const { printAntigravityRouteDiagnostics } = await import(
      './runtimeDiagnostics.js'
    );
    await printAntigravityRouteDiagnostics();
    expect(mockBuildAntigravityRequest).toHaveBeenCalledTimes(1);
  });

  it('reports the previously-missing envelope field presence, never their values', async () => {
    const { printAntigravityRouteDiagnostics } = await import(
      './runtimeDiagnostics.js'
    );
    await printAntigravityRouteDiagnostics();
    const output = logs.join('');
    expect(output).toContain('request.body.requestId.present: true');
    expect(output).toContain(
      'request.body.requestId.shape: agent/<id>/<ts>/<trajectory>/<step>',
    );
    expect(output).toContain('request.body.sessionId.present: true');
    expect(output).toContain('request.body.labels.present: true');
    expect(output).toContain('request.body.userAgent: antigravity');
    expect(output).toContain('request.body.requestType: agent');
    expect(output).toContain('request.authorization.present: true');
    expect(output).toContain('request.authorization.scheme: Bearer');
  });

  it('never prints the access token or project id', async () => {
    const { printAntigravityRouteDiagnostics } = await import(
      './runtimeDiagnostics.js'
    );
    await printAntigravityRouteDiagnostics();
    const output = logs.join('') + errs.join('');
    expect(output).not.toContain('ya29.real-token-never-printed');
    expect(output).not.toContain('real-project-never-printed');
  });

  it('reports the real query keys and confirms no key= parameter', async () => {
    const { printAntigravityRouteDiagnostics } = await import(
      './runtimeDiagnostics.js'
    );
    await printAntigravityRouteDiagnostics();
    const output = logs.join('');
    expect(output).toContain('request.query.alt.present: true');
    expect(output).toContain('request.query.key.present: false');
    expect(output).toContain(
      'request.pathname: /v1internal:streamGenerateContent',
    );
  });
});

describe('runAntigravityRouteTest (--test-antigravity-route)', () => {
  let logs: string[];
  let errs: string[];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    logs = [];
    errs = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      errs.push(String(chunk));
      return true;
    });
    mockInitialize.mockResolvedValue(undefined);
    mockGetProviderState.mockReturnValue({ credentials: validCredential });
    mockFindModel.mockReturnValue(antigravityModel);
    mockBuildAntigravityRequest.mockResolvedValue({
      ok: true,
      descriptor: realDescriptor,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the exact production buildAntigravityRequest export, same as normal chat', async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 200 })) as typeof fetch;
    const { runAntigravityRouteTest } = await import('./runtimeDiagnostics.js');
    await runAntigravityRouteTest('gpt-oss-120b-medium');
    expect(mockBuildAntigravityRequest).toHaveBeenCalledTimes(1);
  });

  it('classifies a 404 without printing the response body', async () => {
    globalThis.fetch = (async () =>
      new Response('<html>some google error page</html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;
    const { runAntigravityRouteTest } = await import('./runtimeDiagnostics.js');
    const code = await runAntigravityRouteTest('gpt-oss-120b-medium');
    const output = logs.join('') + errs.join('');
    expect(code).toBe(0);
    expect(output).toContain('HTTP.status: 404');
    expect(output).toContain('404.classification: ENDPOINT_NOT_FOUND');
    expect(output).not.toContain('<html>');
    expect(output).not.toContain('some google error page');
  });

  it('reports HTTP_OK on a successful response without printing the body', async () => {
    globalThis.fetch = (async () =>
      new Response('data: {"response":{"candidates":[]}}\n\n', {
        status: 200,
      })) as typeof fetch;
    const { runAntigravityRouteTest } = await import('./runtimeDiagnostics.js');
    const code = await runAntigravityRouteTest('gpt-oss-120b-medium');
    const output = logs.join('');
    expect(code).toBe(0);
    expect(output).toContain('HTTP.status: 200');
    expect(output).toContain('result: HTTP_OK');
    expect(output).not.toContain('candidates');
  });

  it('never prints the access token, project id, or prompt content', async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 200 })) as typeof fetch;
    const { runAntigravityRouteTest } = await import('./runtimeDiagnostics.js');
    await runAntigravityRouteTest('gpt-oss-120b-medium');
    const output = logs.join('') + errs.join('');
    expect(output).not.toContain('ya29.real-token-never-printed');
    expect(output).not.toContain('real-project-never-printed');
    expect(output).not.toContain('ping');
  });

  it('fails clearly without calling fetch when there is no stored credential', async () => {
    mockGetProviderState.mockReturnValue(undefined);
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const { runAntigravityRouteTest } = await import('./runtimeDiagnostics.js');
    const code = await runAntigravityRouteTest('gpt-oss-120b-medium');
    expect(code).toBe(1);
    expect(fetchCalled).toBe(false);
  });
});

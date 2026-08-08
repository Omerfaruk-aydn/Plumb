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
const mockResolveUsablePlumbCredential = vi.fn();

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
  resolveUsablePlumbCredential: mockResolveUsablePlumbCredential,
  antigravityTraceEnabled: vi.fn(() => false),
  makeAntigravityTraceId: vi.fn(() => 'ag-trace-123'),
  traceAntigravityFinalHttpRequest: vi.fn(),
  traceAntigravityHttpResponse: vi.fn(),
  extractSafeGoogleErrorDetails: (_bodyText: string) => ({
    detailTypes: [],
    fieldViolations: [],
  }),
  formatSafeGoogleErrorSummary: (_details: unknown) => [],
}));

vi.mock('@google/gemini-cli-provider/dist/auth/credential-resolver.js', () => ({
  resolveUsablePlumbCredential: (scope: string) =>
    mockResolveUsablePlumbCredential(scope),
}));

const mockStoreGetCredentials = vi.fn();
const mockStoreGetProviderMetadata = vi.fn();
const mockRefreshCredential = vi.fn();

vi.mock('@google/gemini-cli-core', () => ({
  initializePlumbProviders: vi.fn().mockResolvedValue(undefined),
  getPlumbCredentialStore: () => ({
    getCredentials: mockStoreGetCredentials,
    getProviderMetadata: mockStoreGetProviderMetadata,
  }),
  getPlumbProviderAuthService: () => ({
    refreshCredential: mockRefreshCredential,
  }),
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
    mockBuildAntigravityRequest.mockImplementation(
      async (options: Record<string, unknown>) => {
        const messages = Array.isArray(options['messages'])
          ? (options['messages'] as Array<{ role: string }>)
          : [];
        const tools = Array.isArray(options['tools'])
          ? (options['tools'] as Array<{
              function?: { name: string };
              name?: string;
            }>)
          : [];
        return {
          ok: true,
          descriptor: {
            ...realDescriptor,
            body: {
              ...realDescriptor.body,
              request: {
                ...realDescriptor.body.request,
                contents: messages.map((m) => ({
                  role: m.role,
                  parts: [{ text: 'test' }],
                })),
                ...(tools.length > 0
                  ? {
                      tools: [
                        {
                          functionDeclarations: tools.map((t) => ({
                            name: t.function?.name ?? t.name,
                          })),
                        },
                      ],
                    }
                  : {}),
                ...(typeof options['systemPrompt'] === 'string'
                  ? {
                      systemInstruction: {
                        role: 'user',
                        parts: [{ text: options['systemPrompt'] }],
                      },
                    }
                  : {}),
              },
            },
          },
        };
      },
    );
    // Raw secure-store view backing the truthful credential.* classification
    // — a single non-expired OAuth entry, matching validCredential.
    mockStoreGetCredentials.mockResolvedValue([
      { provider: 'antigravity', credential: validCredential, source: 'oauth' },
    ]);
    mockStoreGetProviderMetadata.mockResolvedValue({
      accountLabels: [],
      credentialRefs: ['plumb:cred:antigravity:test-ref'],
    });
    mockRefreshCredential.mockResolvedValue({
      success: false,
      error: 'not used in this test',
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
    // Raw secure-store view backing the truthful credential.* classification
    // — a single non-expired OAuth entry, matching validCredential.
    mockStoreGetCredentials.mockResolvedValue([
      { provider: 'antigravity', credential: validCredential, source: 'oauth' },
    ]);
    mockStoreGetProviderMetadata.mockResolvedValue({
      accountLabels: [],
      credentialRefs: ['plumb:cred:antigravity:test-ref'],
    });
    // Canonical resolver — same one production buildAntigravityRequest uses.
    mockResolveUsablePlumbCredential.mockResolvedValue({
      classification: 'VALID_CREDENTIAL',
      credential: validCredential,
      refreshAttempted: false,
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

  it('prints request.attempted exactly once, with the true final value, never a stale placeholder', async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 200 })) as typeof fetch;
    const { runAntigravityRouteTest } = await import('./runtimeDiagnostics.js');
    await runAntigravityRouteTest('gpt-oss-120b-medium');
    const output = logs.join('');
    const matches = output.match(/request\.attempted: (true|false)/g) ?? [];
    expect(matches).toEqual(['request.attempted: true']);
  });

  it('prints request.attempted: false exactly once when the credential is unusable, never true', async () => {
    mockGetProviderState.mockReturnValue(undefined);
    mockStoreGetCredentials.mockResolvedValue([]);
    mockStoreGetProviderMetadata.mockResolvedValue({
      accountLabels: [],
      credentialRefs: [],
    });
    mockResolveUsablePlumbCredential.mockResolvedValue({
      classification: 'NO_CREDENTIAL',
      credential: null,
      refreshAttempted: false,
    });
    const { runAntigravityRouteTest } = await import('./runtimeDiagnostics.js');
    await runAntigravityRouteTest('gpt-oss-120b-medium');
    const output = logs.join('');
    const matches = output.match(/request\.attempted: (true|false)/g) ?? [];
    expect(matches).toEqual(['request.attempted: false']);
  });

  it('fails clearly without calling fetch when there is no stored credential', async () => {
    mockGetProviderState.mockReturnValue(undefined);
    mockStoreGetCredentials.mockResolvedValue([]);
    mockStoreGetProviderMetadata.mockResolvedValue({
      accountLabels: [],
      credentialRefs: [],
    });
    mockResolveUsablePlumbCredential.mockResolvedValue({
      classification: 'NO_CREDENTIAL',
      credential: null,
      refreshAttempted: false,
    });
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

  it('attempts a silent token refresh (not re-authentication) for an expired-but-refreshable credential, then proceeds', async () => {
    const expiredCredential = {
      ...validCredential,
      expires: Date.now() - 1_000,
    };
    // Before repair, the raw-store probe would still find this stale entry
    // — matches the real bug reproduced in streaming.test.ts.
    mockStoreGetCredentials.mockResolvedValue([
      {
        provider: 'antigravity',
        credential: expiredCredential,
        source: 'oauth',
      },
    ]);
    mockResolveUsablePlumbCredential.mockResolvedValue({
      classification: 'VALID_CREDENTIAL',
      credential: validCredential,
      refreshAttempted: true,
    });

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const { runAntigravityRouteTest } = await import('./runtimeDiagnostics.js');
    const code = await runAntigravityRouteTest('gpt-oss-120b-medium');
    const output = logs.join('') + errs.join('');

    expect(output).toContain(
      'credential.classification.before: EXPIRED_REFRESHABLE',
    );
    expect(output).toContain('refresh.attempted: true');
    expect(output).toContain('refresh.result: SUCCESS');
    expect(output).toContain(
      'credential.classification.after: VALID_CREDENTIAL',
    );
    expect(mockResolveUsablePlumbCredential).toHaveBeenCalledWith(
      'antigravity',
    );
    expect(fetchCalled).toBe(true);
    expect(code).toBe(0);
  });

  it('does not send a request and does not ask the user to sign in when refresh fails', async () => {
    const expiredCredential = {
      ...validCredential,
      expires: Date.now() - 1_000,
    };
    mockStoreGetCredentials.mockResolvedValue([
      {
        provider: 'antigravity',
        credential: expiredCredential,
        source: 'oauth',
      },
    ]);
    mockResolveUsablePlumbCredential.mockResolvedValue({
      classification: 'REFRESH_FAILED',
      credential: null,
      refreshAttempted: true,
      refreshFailureReason: 'refresh token rejected',
    });

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const { runAntigravityRouteTest } = await import('./runtimeDiagnostics.js');
    const code = await runAntigravityRouteTest('gpt-oss-120b-medium');
    const output = logs.join('') + errs.join('');

    expect(output).toContain('refresh.attempted: true');
    expect(output).toContain('refresh.result: FAILED');
    expect(output).toContain('http.status: NOT_SENT');
    expect(fetchCalled).toBe(false);
    expect(code).toBe(1);
    expect(output).not.toMatch(/sign in|re-?auth/i);
  });

  it('never reports a refresh attempt for a valid, non-expired credential', async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 200 })) as typeof fetch;
    const { runAntigravityRouteTest } = await import('./runtimeDiagnostics.js');
    const code = await runAntigravityRouteTest('gpt-oss-120b-medium');
    const output = logs.join('') + errs.join('');
    expect(output).toContain('refresh.attempted: false');
    expect(output).not.toContain('refresh.result:');
    expect(code).toBe(0);
  });

  describe('runAntigravityClaudeMatrixTest (--test-antigravity-claude-matrix)', () => {
    it('executes sequential matrix cases A through G and reports structural fields without leaking secrets', async () => {
      mockBuildAntigravityRequest.mockImplementation(
        async (options: Record<string, unknown>) => {
          const messages = Array.isArray(options['messages'])
            ? (options['messages'] as Array<{ role: string }>)
            : [];
          const tools = Array.isArray(options['tools'])
            ? (options['tools'] as Array<{
                function?: { name: string };
                name?: string;
              }>)
            : [];
          return {
            ok: true,
            descriptor: {
              ...realDescriptor,
              body: {
                ...realDescriptor.body,
                request: {
                  ...realDescriptor.body.request,
                  contents: messages.map((m) => ({
                    role: m.role,
                    parts: [{ text: 'test' }],
                  })),
                  ...(tools.length > 0
                    ? {
                        tools: [
                          {
                            functionDeclarations: tools.map((t) => ({
                              name: t.function?.name ?? t.name,
                            })),
                          },
                        ],
                      }
                    : {}),
                  ...(typeof options['systemPrompt'] === 'string'
                    ? {
                        systemInstruction: {
                          role: 'user',
                          parts: [{ text: options['systemPrompt'] }],
                        },
                      }
                    : {}),
                },
              },
            },
          };
        },
      );
      globalThis.fetch = (async () =>
        new Response(null, { status: 200 })) as typeof fetch;
      const { runAntigravityClaudeMatrixTest } = await import(
        './runtimeDiagnostics.js'
      );
      const code = await runAntigravityClaudeMatrixTest('claude-sonnet-4-6');
      const output = logs.join('') + errs.join('');

      expect(output).toContain(
        'PLUMB Antigravity Claude real network matrix test',
      );
      expect(output).toContain('--- CASE A: one user content, zero tools ---');
      expect(output).toContain(
        '--- CASE B: two source user messages after canonical normalization, zero tools ---',
      );
      expect(output).toContain(
        '--- CASE C: one user, one known minimal tool ---',
      );
      expect(output).toContain('--- CASE D: one user, full 16 PLUMB tools ---');
      expect(output).toContain(
        '--- CASE E: normalized production history, zero tools ---',
      );
      expect(output).toContain(
        '--- CASE F: normalized production history, full 16 tools ---',
      );
      expect(output).toContain(
        '--- CASE G: full normal PLUMB request shape ---',
      );

      expect(output).toContain('contents.roles: user');
      expect(output).toContain('tools.count: 16');
      expect(output).not.toContain('ya29.');
      expect(output).not.toContain('Bearer');
      expect(code).toBe(0);
    });
  });
});

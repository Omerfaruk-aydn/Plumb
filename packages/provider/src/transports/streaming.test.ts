/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Transport/stream activation contract: OMP EventStream is the active
 * stream-normalization authority and is importable by the PLUMB facade.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { installBunGlobal } from '../omp-shims/bun-runtime.js';
import { createNormalizationStream, plumbModelStream } from './streaming.js';
import { EventStream as OmpEventStream } from '../omp-ai/utils/event-stream.js';
import type { PlumbModel, PlumbStreamEvent } from '../types.js';

installBunGlobal();

const mockGetProviderState = vi.fn();
vi.mock('../registry/provider-registry.js', () => ({
  getPlumbProviderRegistry: () => ({
    getProviderState: mockGetProviderState,
  }),
}));

const mockResolveUsablePlumbCredential = vi.fn();
vi.mock('../auth/credential-resolver.js', () => ({
  resolveUsablePlumbCredential: mockResolveUsablePlumbCredential,
}));

describe('transport/stream activation', () => {
  it('creates an OMP-backed PlumbEventStream', () => {
    const stream = createNormalizationStream();
    expect(stream).toBeInstanceOf(OmpEventStream);

    // Push a done event through the OMP pipeline
    stream.push({ type: 'done' });

    // The stream should be consumed after a terminal event
    expect(stream.done).toBe(true);
  });

  it('OMP EventStream is directly importable by the facade', () => {
    const stream = new OmpEventStream<{ type: string }, void>(
      (e) => e.type === 'end',
      () => undefined as void,
    );
    expect(stream).toBeInstanceOf(OmpEventStream);
    expect(stream.done).toBe(false);
  });
});

describe('plumbModelStream — missing-credential guard', () => {
  // This is the transport PlumbContentGenerator actually calls for real
  // chat streaming (see packages/core/src/core/plumbContentGenerator.ts).
  // A missing/empty apiKey must fail with a classified error event instead
  // of silently building `Authorization: Bearer ` (no token), which is what
  // GitHub rejects as "Authorization header is badly formatted".
  const copilotModel: PlumbModel = {
    id: 'gpt-5.5',
    provider: 'github-copilot',
    api: 'openai-completions',
    contextWindow: 128_000,
    maxTokens: 8_192,
    reasoning: false,
    input: 'text',
  };

  it('yields a MISSING_CREDENTIAL error instead of sending an empty Bearer header', async () => {
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: copilotModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
    })) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'MISSING_CREDENTIAL' },
    });
  });

  it('never reaches fetch for an empty credential', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCalled = true;
      return originalFetch(...args);
    }) as typeof fetch;
    try {
      for await (const _event of plumbModelStream({
        model: copilotModel,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: '',
      })) {
        // drain
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalled).toBe(false);
  });
});

describe('plumbModelStream — GitHub Copilot anthropic-messages auth header', () => {
  // Real-world regression: claude-sonnet-5 under github-copilot resolves to
  // api: 'anthropic-messages' in the bundled catalog, routing through
  // anthropicMessagesStream (not openAICompatibleStream). That function
  // defaulted to `x-api-key`, which GitHub's Copilot proxy rejects with
  // "missing required Authorization header" even when a real credential is
  // present — a different, real-transport-only bug from the empty-credential
  // guard above.
  const copilotClaudeModel: PlumbModel = {
    id: 'claude-sonnet-5',
    provider: 'github-copilot',
    api: 'anthropic-messages',
    baseUrl: 'https://api.githubcopilot.com',
    contextWindow: 200_000,
    maxTokens: 8_192,
    reasoning: false,
    input: 'text',
  };

  const nativeAnthropicModel: PlumbModel = {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    contextWindow: 200_000,
    maxTokens: 8_192,
    reasoning: false,
    input: 'text',
  };

  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends Authorization: Bearer (not x-api-key) for github-copilot', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(null, { status: 200, headers: {} });
    }) as typeof fetch;

    for await (const _event of plumbModelStream({
      model: copilotClaudeModel,
      messages: [{ role: 'user', content: 'merhaba' }],
      apiKey: 'gho_real_copilot_token',
    })) {
      // drain
    }

    expect(capturedHeaders?.['Authorization']).toBe(
      'Bearer gho_real_copilot_token',
    );
    expect(capturedHeaders?.['x-api-key']).toBeUndefined();
  });

  it('still uses x-api-key for native (non-Copilot) Anthropic requests', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(null, { status: 200, headers: {} });
    }) as typeof fetch;

    for await (const _event of plumbModelStream({
      model: nativeAnthropicModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-ant-real-key',
    })) {
      // drain
    }

    expect(capturedHeaders?.['x-api-key']).toBe('sk-ant-real-key');
    expect(capturedHeaders?.['Authorization']).toBeUndefined();
  });

  it('yields MISSING_CREDENTIAL for an empty credential on the anthropic-messages path too', async () => {
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: copilotClaudeModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
    })) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'MISSING_CREDENTIAL' },
    });
  });
});

describe('plumbModelStream — Anthropic Messages HTTP/SSE error classification (ANTHROPIC_MESSAGES, incl. github-copilot)', () => {
  const nativeAnthropicModel: PlumbModel = {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    contextWindow: 200_000,
    maxTokens: 8_192,
    reasoning: false,
    input: 'text',
  };

  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function runWithFetchResponse(
    body: string,
    status: number,
  ): Promise<PlumbStreamEvent[]> {
    globalThis.fetch = (async () =>
      new Response(body, { status })) as typeof fetch;
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: nativeAnthropicModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-ant-test',
    })) {
      events.push(event);
    }
    return events;
  }

  it('HTTP 401 authentication_error -> AUTH_REQUIRED', async () => {
    const events = await runWithFetchResponse(
      JSON.stringify({
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      }),
      401,
    );
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'AUTH_REQUIRED', message: 'invalid x-api-key' },
    });
  });

  it('HTTP 403 permission_error -> ACCOUNT_RESTRICTED', async () => {
    const events = await runWithFetchResponse(
      JSON.stringify({
        type: 'error',
        error: { type: 'permission_error', message: 'no access to this model' },
      }),
      403,
    );
    expect(events[0]).toMatchObject({
      error: { code: 'ACCOUNT_RESTRICTED' },
    });
  });

  it('HTTP 404 not_found_error -> MODEL_NOT_AVAILABLE', async () => {
    const events = await runWithFetchResponse(
      JSON.stringify({
        type: 'error',
        error: { type: 'not_found_error', message: 'model not found' },
      }),
      404,
    );
    expect(events[0]).toMatchObject({
      error: { code: 'MODEL_NOT_AVAILABLE' },
    });
  });

  it('HTTP 429 rate_limit_error -> RATE_LIMITED', async () => {
    const events = await runWithFetchResponse(
      JSON.stringify({
        type: 'error',
        error: {
          type: 'rate_limit_error',
          message: 'Number of requests has exceeded your per-minute rate limit',
        },
      }),
      429,
    );
    expect(events[0]).toMatchObject({
      error: { code: 'RATE_LIMITED' },
    });
  });

  it('HTTP 529 overloaded_error -> UPSTREAM_ERROR', async () => {
    const events = await runWithFetchResponse(
      JSON.stringify({
        type: 'error',
        error: { type: 'overloaded_error', message: 'Overloaded' },
      }),
      529,
    );
    expect(events[0]).toMatchObject({
      error: { code: 'UPSTREAM_ERROR' },
    });
  });

  it('a proxy/gateway HTML 502 (never reached Anthropic) falls back to generic classification without leaking markup', async () => {
    const events = await runWithFetchResponse(
      '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>',
      502,
    );
    expect(events[0]).toMatchObject({ error: { code: 'UPSTREAM_ERROR' } });
    const message = (events[0] as { error?: { message?: string } }).error
      ?.message;
    expect(message).not.toContain('<html');
  });

  it('a network failure (fetch throws) -> NETWORK_ERROR', async () => {
    globalThis.fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND api.anthropic.com');
    }) as typeof fetch;
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: nativeAnthropicModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-ant-test',
    })) {
      events.push(event);
    }
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'NETWORK_ERROR' },
    });
  });

  it('a mid-stream SSE `event: error` with a documented type is classified (invalid_request_error -> INVALID_REQUEST)', async () => {
    globalThis.fetch = (async () =>
      new Response(
        `data: ${JSON.stringify({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'messages: at least one message is required',
          },
        })}\n\n`,
        { status: 200 },
      )) as typeof fetch;
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: nativeAnthropicModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-ant-test',
    })) {
      events.push(event);
    }
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toMatchObject({
      error: {
        code: 'INVALID_REQUEST',
        message: 'messages: at least one message is required',
      },
    });
  });

  it('a mid-stream SSE `event: error` with an undocumented type keeps the raw type as a fallback code', async () => {
    globalThis.fetch = (async () =>
      new Response(
        `data: ${JSON.stringify({
          type: 'error',
          error: { type: 'some_future_error_type', message: 'new error kind' },
        })}\n\n`,
        { status: 200 },
      )) as typeof fetch;
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: nativeAnthropicModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-ant-test',
    })) {
      events.push(event);
    }
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toMatchObject({
      error: { code: 'some_future_error_type', message: 'new error kind' },
    });
  });
});

describe('plumbModelStream — Gemini Developer API HTTP error classification (GEMINI_GENERATE_CONTENT, also google-vertex)', () => {
  const geminiModel: PlumbModel = {
    id: 'gemini-3.1-pro-preview',
    provider: 'google',
    api: 'google-generative-ai',
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    reasoning: true,
    input: 'text',
  };

  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function googleErrorBody(status: string, message: string): string {
    return JSON.stringify({
      error: { code: 400, message, status, details: [] },
    });
  }

  async function runWithFetchResponse(
    body: string,
    status: number,
  ): Promise<PlumbStreamEvent[]> {
    globalThis.fetch = (async () =>
      new Response(body, { status })) as typeof fetch;
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: geminiModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'AIza-test-key',
    })) {
      events.push(event);
    }
    return events;
  }

  it('PERMISSION_DENIED -> ACCOUNT_RESTRICTED', async () => {
    const events = await runWithFetchResponse(
      googleErrorBody('PERMISSION_DENIED', 'Caller does not have permission'),
      403,
    );
    expect(events[0]).toMatchObject({
      error: {
        code: 'ACCOUNT_RESTRICTED',
        message: 'Caller does not have permission',
      },
    });
  });

  it('UNAUTHENTICATED -> AUTH_REQUIRED', async () => {
    const events = await runWithFetchResponse(
      googleErrorBody('UNAUTHENTICATED', 'API key not valid'),
      401,
    );
    expect(events[0]).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
  });

  it('INVALID_ARGUMENT -> INVALID_REQUEST', async () => {
    const events = await runWithFetchResponse(
      googleErrorBody('INVALID_ARGUMENT', 'Invalid value at contents'),
      400,
    );
    expect(events[0]).toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('NOT_FOUND -> MODEL_NOT_AVAILABLE', async () => {
    const events = await runWithFetchResponse(
      googleErrorBody('NOT_FOUND', 'models/does-not-exist is not found'),
      404,
    );
    expect(events[0]).toMatchObject({
      error: { code: 'MODEL_NOT_AVAILABLE' },
    });
  });

  it('RESOURCE_EXHAUSTED with quota wording -> QUOTA_EXHAUSTED', async () => {
    const events = await runWithFetchResponse(
      googleErrorBody(
        'RESOURCE_EXHAUSTED',
        'Quota exceeded for quota metric requests per day',
      ),
      429,
    );
    expect(events[0]).toMatchObject({
      error: { code: 'QUOTA_EXHAUSTED' },
    });
  });

  it('a 5xx with no structured Google status falls back to UPSTREAM_ERROR', async () => {
    const events = await runWithFetchResponse('Internal error occurred', 503);
    expect(events[0]).toMatchObject({
      error: { code: 'UPSTREAM_ERROR' },
    });
  });

  it('a network failure (fetch throws) -> NETWORK_ERROR', async () => {
    globalThis.fetch = (async () => {
      throw new Error(
        'getaddrinfo ENOTFOUND generativelanguage.googleapis.com',
      );
    }) as typeof fetch;
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: geminiModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'AIza-test-key',
    })) {
      events.push(event);
    }
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'NETWORK_ERROR' },
    });
  });

  it('cancellation (AbortError) yields a done/cancelled event, never an error', async () => {
    globalThis.fetch = (async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }) as typeof fetch;
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: geminiModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'AIza-test-key',
    })) {
      events.push(event);
    }
    expect(events).toEqual([{ type: 'done', finishReason: 'cancelled' }]);
  });
});

describe('plumbModelStream — Google Antigravity (Cloud Code Assist) transport', () => {
  // Real production defect: an Antigravity request leaked the OAuth access
  // token into `?key=<token>` and hit a public-Gemini-API-shaped path
  // (`/models/<id>:streamGenerateContent`) that doesn't exist on the real
  // Cloud Code Assist host, producing a Google HTML 404. The real endpoint
  // is `/v1internal:streamGenerateContent` with `Authorization: Bearer` —
  // see the pinned reference in omp-ai/providers/google-gemini-cli.ts.
  const antigravityModel = (modelId: string): PlumbModel => ({
    id: modelId,
    provider: 'google-antigravity',
    api: 'google-gemini-cli',
    baseUrl: 'https://daily-cloudcode-pa.googleapis.com',
    contextWindow: 200_000,
    maxTokens: 8_192,
    reasoning: false,
    input: 'text',
  });

  const validOAuthCredential = {
    type: 'oauth' as const,
    provider: 'google-antigravity',
    access: 'ya29.real-oauth-access-token',
    refresh: 'refresh-token',
    expires: Date.now() + 3_600_000,
    projectId: 'my-real-gcp-project',
  };

  afterEach(() => {
    mockGetProviderState.mockReset();
    mockResolveUsablePlumbCredential.mockReset();
  });

  for (const modelId of ['gemini-3-pro', 'claude-sonnet-4-6', 'gpt-oss-120b']) {
    it(
      `routes ${modelId} through google-antigravity regardless of model family prefix`,
      { timeout: 15000 },
      async () => {
        mockResolveUsablePlumbCredential.mockResolvedValue({
          classification: 'VALID_CREDENTIAL',
          credential: validOAuthCredential,
          refreshAttempted: false,
        });
        let capturedUrl = '';
        let capturedHeaders: Record<string, string> | undefined;
        let capturedBody: Record<string, unknown> | undefined;
        globalThis.fetch = (async (
          url: string | URL | Request,
          init?: RequestInit,
        ) => {
          capturedUrl = String(url);
          capturedHeaders = init?.headers as Record<string, string>;
          capturedBody = JSON.parse(String(init?.body));
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"response":{"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"hi"}]}}]}}\n\n',
                ),
              );
              controller.close();
            },
          });
          return new Response(stream, { status: 200 });
        }) as typeof fetch;

        for await (const _event of plumbModelStream({
          model: antigravityModel(modelId),
          messages: [{ role: 'user', content: 'merhaba' }],
          apiKey: 'unused-for-this-provider',
        })) {
          // drain
        }

        // ROUTING_PROVIDER: google-antigravity, regardless of the model's
        // own family (gemini/claude/gpt-oss) — dispatch is by model.api, not
        // by inferring a provider from the model id prefix.
        expect(capturedBody?.['model']).toBe(modelId);
        expect(capturedBody?.['project']).toBe('my-real-gcp-project');

        // Real production defect (round 2): these envelope fields — generated
        // by the pinned buildAntigravityRequestEnvelope, reached only by
        // calling the real exported buildRequest — were entirely absent from
        // the hand-built body in the first fix and are suspected load-bearing
        // for Google's request routing (still 404s without them).
        expect(typeof capturedBody?.['requestId']).toBe('string');
        expect(capturedBody?.['requestId']).toMatch(/^agent\//);
        expect(capturedBody?.['userAgent']).toBe('antigravity');
        expect(capturedBody?.['requestType']).toBe('agent');
        const request = capturedBody?.['request'] as
          | Record<string, unknown>
          | undefined;
        expect(typeof request?.['sessionId']).toBe('string');
        expect(request?.['labels']).toBeTruthy();

        // OAUTH_TOKEN_IN_QUERY: ZERO / QUERY_KEY_PARAMETER_FOR_ANTIGRAVITY_OAUTH: ZERO
        const query = new URL(capturedUrl).searchParams;
        expect(query.has('key')).toBe(false);
        expect(capturedUrl).not.toContain(validOAuthCredential.access);

        // Real pinned endpoint/path, not the public Gemini API shape.
        expect(capturedUrl).toBe(
          'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
        );

        // AUTHORIZATION_HEADER_PRESENT: TRUE
        expect(capturedHeaders?.['Authorization']).toBe(
          `Bearer ${validOAuthCredential.access}`,
        );
        expect(capturedHeaders?.['x-api-key']).toBeUndefined();
      },
    );
  }

  it('sends the catalog requestModelId (wire id), never the display id, when they differ', async () => {
    // Real catalog shape: gpt-oss-120b (display id) has
    // requestModelId 'gpt-oss-120b-medium' (wire id) — confirmed against
    // the actual bundled antigravity catalog. Sending the display id
    // instead of the wire id is a plausible cause of a route-not-found 404.
    mockResolveUsablePlumbCredential.mockResolvedValue({
      classification: 'VALID_CREDENTIAL',
      credential: validOAuthCredential,
      refreshAttempted: false,
    });
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response('data: {"response":{"candidates":[]}}\n\n', {
        status: 200,
      });
    }) as typeof fetch;

    const model: PlumbModel = {
      ...antigravityModel('gpt-oss-120b'),
      requestModelId: 'gpt-oss-120b-medium',
    };

    for await (const _event of plumbModelStream({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'unused',
    })) {
      // drain
    }

    expect(capturedBody?.['model']).toBe('gpt-oss-120b-medium');
    expect(capturedBody?.['model']).not.toBe('gpt-oss-120b');
  });

  it('never falls back to the public Gemini API host/path for google-antigravity', async () => {
    mockResolveUsablePlumbCredential.mockResolvedValue({
      classification: 'VALID_CREDENTIAL',
      credential: validOAuthCredential,
      refreshAttempted: false,
    });
    let capturedUrl = '';
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response('data: {"response":{"candidates":[]}}\n\n', {
        status: 200,
      });
    }) as typeof fetch;

    for await (const _event of plumbModelStream({
      model: antigravityModel('claude-sonnet-4-6'),
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'unused',
    })) {
      // drain
    }

    // PUBLIC_GEMINI_FALLBACK: ZERO
    expect(capturedUrl).not.toContain('generativelanguage.googleapis.com');
    expect(capturedUrl).not.toContain('/models/claude-sonnet-4-6:');
  });

  it('yields MISSING_CREDENTIAL and never calls fetch when no OAuth credential is stored', async () => {
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

    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: antigravityModel('gemini-3-pro'),
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
    })) {
      events.push(event);
    }

    expect(fetchCalled).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'MISSING_CREDENTIAL' },
    });
  });

  it('yields MISSING_CREDENTIAL when the stored credential has no projectId', async () => {
    mockResolveUsablePlumbCredential.mockResolvedValue({
      classification: 'VALID_CREDENTIAL',
      credential: { ...validOAuthCredential, projectId: undefined },
      refreshAttempted: false,
    });
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: antigravityModel('gemini-3-pro'),
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'irrelevant',
    })) {
      events.push(event);
    }

    expect(fetchCalled).toBe(false);
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'MISSING_CREDENTIAL' },
    });
  });

  it('resolves the credential via the PLUMB registry id, not the raw model.provider OMP id', async () => {
    // Real production defect: model.provider on a catalog-projected
    // PlumbModel carries the OMP registry id ("google-antigravity"), but
    // PlumbProviderRegistry/credential-store state is keyed by the PLUMB
    // presentation id ("antigravity") that login/UI/settings actually use.
    // Looking the credential up under model.provider directly always misses
    // — even with a real, valid, stored OAuth credential — and silently
    // falls through to MISSING_CREDENTIAL without ever sending a request.
    mockResolveUsablePlumbCredential.mockImplementation(async (id: string) =>
      id === 'antigravity'
        ? {
            classification: 'VALID_CREDENTIAL',
            credential: validOAuthCredential,
            refreshAttempted: false,
          }
        : {
            classification: 'NO_CREDENTIAL',
            credential: null,
            refreshAttempted: false,
          },
    );
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('data: {"response":{"candidates":[]}}\n\n', {
        status: 200,
      });
    }) as typeof fetch;

    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: antigravityModel('gemini-3-pro'),
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'unused',
    })) {
      events.push(event);
    }

    expect(mockResolveUsablePlumbCredential).toHaveBeenCalledWith(
      'antigravity',
    );
    expect(mockResolveUsablePlumbCredential).not.toHaveBeenCalledWith(
      'google-antigravity',
    );
    expect(fetchCalled).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('a plain API-key Google/Gemini provider is unaffected (still uses the public API path)', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response('data: {"candidates":[]}\n\n', { status: 200 });
    }) as typeof fetch;

    const geminiApiModel: PlumbModel = {
      id: 'gemini-2.5-flash',
      provider: 'google',
      api: 'google-generative-ai',
      contextWindow: 1_000_000,
      maxTokens: 8_192,
      reasoning: false,
      input: 'text',
    };

    for await (const _event of plumbModelStream({
      model: geminiApiModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'plain-api-key',
    })) {
      // drain
    }

    expect(capturedUrl).toContain('generativelanguage.googleapis.com');
    expect(capturedUrl).toContain('key=plain-api-key');
    // The registry lookup used by the Antigravity path must never be
    // consulted for a plain API-key Gemini request.
    expect(mockGetProviderState).not.toHaveBeenCalled();
  });

  describe('PLUMB_ANTIGRAVITY_TRACE_SAFE opt-in tracing', () => {
    const originalEnv = process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE'];

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE'];
      } else {
        process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE'] = originalEnv;
      }
      vi.restoreAllMocks();
    });

    it('emits no trace output by default (env unset)', async () => {
      delete process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE'];
      mockResolveUsablePlumbCredential.mockResolvedValue({
        classification: 'VALID_CREDENTIAL',
        credential: validOAuthCredential,
        refreshAttempted: false,
      });
      const stderrLines: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
        stderrLines.push(String(chunk));
        return true;
      });
      globalThis.fetch = (async () =>
        new Response('data: {"response":{"candidates":[]}}\n\n', {
          status: 200,
        })) as typeof fetch;

      for await (const _event of plumbModelStream({
        model: antigravityModel('gemini-3-pro'),
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'unused',
      })) {
        // drain
      }

      expect(stderrLines.join('')).not.toContain('antigravity-trace');
    });

    it('emits a safe trace with a correlation id and no secrets when PLUMB_ANTIGRAVITY_TRACE_SAFE=1', async () => {
      process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE'] = '1';
      mockResolveUsablePlumbCredential.mockResolvedValue({
        classification: 'VALID_CREDENTIAL',
        credential: validOAuthCredential,
        refreshAttempted: false,
      });
      const stderrLines: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
        stderrLines.push(String(chunk));
        return true;
      });
      globalThis.fetch = (async () =>
        new Response('data: {"response":{"candidates":[]}}\n\n', {
          status: 200,
        })) as typeof fetch;

      for await (const _event of plumbModelStream({
        model: antigravityModel('gemini-3-pro'),
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'unused',
      })) {
        // drain
      }

      const output = stderrLines.join('');
      expect(output).toContain('[antigravity-trace]');
      expect(output).toMatch(/traceId=ag-[a-z0-9]+/);
      expect(output).toContain('HTTP.status=200');
      expect(output).toContain(
        'request.origin: https://daily-cloudcode-pa.googleapis.com',
      );
      expect(output).toContain(
        'request.pathname: /v1internal:streamGenerateContent',
      );
      // Never a secret.
      expect(output).not.toContain(validOAuthCredential.access);
      expect(output).not.toContain(validOAuthCredential.projectId);
      expect(output).not.toContain('hi');
      // Same correlation id threads through request-build and response lines.
      const ids = [...output.matchAll(/traceId=(ag-[a-z0-9]+)/g)].map(
        (m) => m[1],
      );
      expect(new Set(ids).size).toBe(1);
    });
  });
});

describe('plumbModelStream — OpenAI-compatible HTTP error classification (openai-completions, openai-responses, openrouter, github-copilot)', () => {
  const openaiModel: PlumbModel = {
    id: 'gpt-5.5',
    provider: 'openai',
    api: 'openai-completions',
    contextWindow: 128_000,
    maxTokens: 8_192,
    reasoning: false,
    input: 'text',
  };

  async function runWithFetchResponse(
    body: string,
    status: number,
  ): Promise<PlumbStreamEvent[]> {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(body, { status })) as typeof fetch;
    try {
      const events: PlumbStreamEvent[] = [];
      for await (const event of plumbModelStream({
        model: openaiModel,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'sk-test',
      })) {
        events.push(event);
      }
      return events;
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  it('401 -> AUTH_REQUIRED', async () => {
    const events = await runWithFetchResponse(
      JSON.stringify({ error: { message: 'Incorrect API key provided' } }),
      401,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'AUTH_REQUIRED', message: 'Incorrect API key provided' },
    });
  });

  it('403 -> ACCOUNT_RESTRICTED', async () => {
    const events = await runWithFetchResponse(
      JSON.stringify({ error: { message: 'Country not supported' } }),
      403,
    );
    expect(events[0]).toMatchObject({
      error: { code: 'ACCOUNT_RESTRICTED' },
    });
  });

  it('404 -> MODEL_NOT_AVAILABLE', async () => {
    const events = await runWithFetchResponse(
      JSON.stringify({ error: { message: 'The model does not exist' } }),
      404,
    );
    expect(events[0]).toMatchObject({
      error: { code: 'MODEL_NOT_AVAILABLE' },
    });
  });

  it('429 with quota wording -> QUOTA_EXHAUSTED', async () => {
    const events = await runWithFetchResponse(
      JSON.stringify({
        error: { message: 'You exceeded your current quota' },
      }),
      429,
    );
    expect(events[0]).toMatchObject({
      error: { code: 'QUOTA_EXHAUSTED' },
    });
  });

  it('429 without quota wording -> RATE_LIMITED', async () => {
    const events = await runWithFetchResponse(
      JSON.stringify({ error: { message: 'Rate limit reached for requests' } }),
      429,
    );
    expect(events[0]).toMatchObject({
      error: { code: 'RATE_LIMITED' },
    });
  });

  it('500 -> UPSTREAM_ERROR', async () => {
    const events = await runWithFetchResponse('Internal Server Error', 500);
    expect(events[0]).toMatchObject({
      error: { code: 'UPSTREAM_ERROR' },
    });
  });

  it('a raw HTML 502 gateway page never leaks into the error message', async () => {
    const events = await runWithFetchResponse(
      '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>',
      502,
    );
    expect(events[0]).toMatchObject({ error: { code: 'UPSTREAM_ERROR' } });
    const message = (events[0] as { error?: { message?: string } }).error
      ?.message;
    expect(message).not.toContain('<html');
    expect(message).not.toContain('<body');
  });

  it('a network failure (fetch throws) -> NETWORK_ERROR', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND api.openai.com');
    }) as typeof fetch;
    try {
      const events: PlumbStreamEvent[] = [];
      for await (const event of plumbModelStream({
        model: openaiModel,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'sk-test',
      })) {
        events.push(event);
      }
      expect(events[0]).toMatchObject({
        type: 'error',
        error: { code: 'NETWORK_ERROR' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('cancellation (AbortError) yields a done/cancelled event, never an error', async () => {
    const controller = new AbortController();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }) as typeof fetch;
    try {
      const events: PlumbStreamEvent[] = [];
      for await (const event of plumbModelStream({
        model: openaiModel,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'sk-test',
        signal: controller.signal,
      })) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'done',
        finishReason: 'cancelled',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('MISSING_CREDENTIAL is unaffected by the new classification (still checked before any fetch)', async () => {
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: openaiModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
    })) {
      events.push(event);
    }
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'MISSING_CREDENTIAL' },
    });
  });
});

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
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';
import type {
  PlumbModel,
  PlumbStreamEvent,
  PlumbStreamOptions,
} from '../types.js';

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

  it('regression: an allowUnauthenticated local provider (lm-studio) with an empty apiKey reaches fetch instead of failing with MISSING_CREDENTIAL', async () => {
    const localModel: PlumbModel = {
      id: 'local-lm',
      provider: 'lm-studio',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:1234',
      contextWindow: 131072,
      maxTokens: 32768,
      reasoning: false,
      input: 'text',
    };
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    let sawEmptyBearer = false;
    globalThis.fetch = (async (
      url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      fetchCalled = true;
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.['Authorization'] === 'Bearer ') sawEmptyBearer = true;
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;
    try {
      for await (const _event of plumbModelStream({
        model: localModel,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: '',
      })) {
        // drain
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalled).toBe(true);
    expect(sawEmptyBearer).toBe(false);
  });

  it('applies the selected credential after model headers, case-insensitively', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response('data: [DONE]\n\n', { status: 200 });
    }) as typeof fetch;

    for await (const _event of plumbModelStream({
      model: {
        ...copilotModel,
        provider: 'vllm',
        baseUrl: 'http://127.0.0.1:8000/v1',
        headers: { authorization: 'Bearer attacker-value' },
      },
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'trusted-local-token',
    })) {
      // drain
    }

    expect(capturedHeaders?.['authorization']).toBeUndefined();
    expect(capturedHeaders?.['Authorization']).toBe(
      'Bearer trusted-local-token',
    );
  });

  it('sends a Portkey gateway key only as x-portkey-api-key', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const originalFetch = globalThis.fetch;
    setProviderConfigResolver(
      (providerId): Readonly<Record<string, string>> =>
        providerId === 'portkey'
          ? { routingMode: 'provider', portkeyProvider: 'openai' }
          : {},
    );
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response('data: [DONE]\n\n', { status: 200 });
    }) as typeof fetch;
    try {
      for await (const _event of plumbModelStream({
        model: {
          ...copilotModel,
          provider: 'portkey',
          baseUrl: 'https://api.portkey.ai/v1',
        },
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'portkey-gateway-canary',
      })) {
        // drain
      }
    } finally {
      globalThis.fetch = originalFetch;
      setProviderConfigResolver(undefined);
    }

    expect(capturedHeaders?.['x-portkey-api-key']).toBe(
      'portkey-gateway-canary',
    );
    expect(capturedHeaders?.['Authorization']).toBeUndefined();
    expect(capturedHeaders?.['x-portkey-provider']).toBe('openai');
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

  it('keeps a Cloudflare gateway token out of upstream auth headers', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(null, { status: 200, headers: {} });
    }) as typeof fetch;

    for await (const _event of plumbModelStream({
      model: {
        ...nativeAnthropicModel,
        id: 'anthropic/claude-sonnet-4-6',
        provider: 'cloudflare-ai-gateway',
        baseUrl:
          'https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/anthropic',
        headers: {
          Authorization: 'Bearer upstream-canary',
          'X-Api-Key': 'upstream-api-key-canary',
        },
      },
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'cloudflare-gateway-canary',
    })) {
      // drain
    }

    expect(capturedUrl).toBe(
      'https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/anthropic/v1/messages',
    );
    expect(capturedHeaders?.['cf-aig-authorization']).toBe(
      'Bearer cloudflare-gateway-canary',
    );
    expect(capturedHeaders?.['Authorization']).toBeUndefined();
    expect(capturedHeaders?.['X-Api-Key']).toBeUndefined();
    expect(JSON.stringify(capturedHeaders)).not.toContain('upstream-canary');
  });

  it('fails closed before fetch when Cloudflare still has placeholder routing', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    const events: PlumbStreamEvent[] = [];

    for await (const event of plumbModelStream({
      model: {
        ...nativeAnthropicModel,
        provider: 'cloudflare-ai-gateway',
        baseUrl:
          'https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic',
      },
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'cloudflare-gateway-canary',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'error',
        error: expect.objectContaining({ code: 'ENDPOINT_NOT_CONFIGURED' }),
      },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
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

  describe('GOOGLE_CLOUD_CODE_ASSIST error classification (deliberately unchanged — preservation test)', () => {
    // This dialect (googleCloudCodeAssistStream) is the highest-blast-radius
    // REAL_VERIFIED path in this file and already implements its own precise
    // classification (ENDPOINT_NOT_FOUND for 404, HTTP_${status}_${safeStatus}
    // when Google's structured status is present). The taxonomy-normalization
    // work in this file deliberately does NOT touch it — these tests pin the
    // existing behavior so a future change here is a conscious decision, not
    // an accidental regression.
    it('a 404 (route not found) yields ENDPOINT_NOT_FOUND, unchanged', async () => {
      mockResolveUsablePlumbCredential.mockResolvedValue({
        classification: 'VALID_CREDENTIAL',
        credential: validOAuthCredential,
        refreshAttempted: false,
      });
      globalThis.fetch = (async () =>
        new Response('<html><body>404 Not Found</body></html>', {
          status: 404,
        })) as typeof fetch;

      const events: PlumbStreamEvent[] = [];
      for await (const event of plumbModelStream({
        model: antigravityModel('gemini-3-pro'),
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'unused',
      })) {
        events.push(event);
      }
      expect(events[0]).toMatchObject({
        type: 'error',
        error: { code: 'ENDPOINT_NOT_FOUND' },
      });
    });

    it('a 403 with a structured Google status yields HTTP_403_<status>, unchanged', async () => {
      mockResolveUsablePlumbCredential.mockResolvedValue({
        classification: 'VALID_CREDENTIAL',
        credential: validOAuthCredential,
        refreshAttempted: false,
      });
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: 'Caller does not have permission',
              status: 'PERMISSION_DENIED',
            },
          }),
          { status: 403 },
        )) as typeof fetch;

      const events: PlumbStreamEvent[] = [];
      for await (const event of plumbModelStream({
        model: antigravityModel('gemini-3-pro'),
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'unused',
      })) {
        events.push(event);
      }
      expect(events[0]).toMatchObject({
        type: 'error',
        error: { code: 'HTTP_403_PERMISSION_DENIED' },
      });
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

  it('a transport timeout is classified separately from caller cancellation', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      const err = new Error('timed out with secret body that must not surface');
      err.name = 'TimeoutError';
      throw err;
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
      expect(events).toEqual([
        {
          type: 'error',
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Provider request timed out.',
            retryable: true,
          },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('cancellation (AbortError) yields a done/cancelled event, never an error', async () => {
    const controller = new AbortController();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      controller.abort();
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

describe('fragmented streaming tool-call normalization', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('assembles OpenAI tool-call deltas by index before emitting one canonical call', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_weather","function":{"name":"get_","arguments":"{\\"path\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"weather","arguments":"\\".\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
      '',
    ].join('\n\n');
    globalThis.fetch = vi.fn(
      async () =>
        new Response(sse, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    ) as typeof fetch;

    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: {
        id: 'local-tool-model',
        provider: 'lm-studio',
        api: 'openai-completions',
        baseUrl: 'http://127.0.0.1:1234/v1',
        contextWindow: 4096,
        maxTokens: 256,
        reasoning: false,
        input: 'text',
      },
      messages: [{ role: 'user', content: 'inspect' }],
      apiKey: '',
    })) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === 'tool_call')).toEqual([
      {
        type: 'tool_call',
        toolCall: {
          id: 'call_weather',
          name: 'get_weather',
          arguments: '{"path":"."}',
        },
      },
    ]);
    expect(events.at(-1)).toEqual({
      type: 'done',
      finishReason: 'tool_calls',
    });
  });

  it('assembles Anthropic input_json_delta fragments with their tool id and name', async () => {
    const sse = [
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_123","name":"read_file","input":{}}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"README.md\\"}"}}',
      'data: {"type":"content_block_stop","index":1}',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
      '',
    ].join('\n\n');
    globalThis.fetch = vi.fn(
      async () =>
        new Response(sse, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    ) as typeof fetch;

    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: {
        id: 'claude-tool-model',
        provider: 'anthropic-api',
        api: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com',
        contextWindow: 4096,
        maxTokens: 256,
        reasoning: false,
        input: 'text',
      },
      messages: [{ role: 'user', content: 'inspect' }],
      apiKey: 'anthropic-test-key',
    })) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === 'tool_call')).toEqual([
      {
        type: 'tool_call',
        toolCall: {
          id: 'tool_123',
          name: 'read_file',
          arguments: '{"path":"README.md"}',
        },
      },
    ]);
    expect(events.at(-1)).toEqual({
      type: 'done',
      finishReason: 'tool_calls',
    });
  });

  it('marks an AbortError raised by the response reader as cancelled', async () => {
    const encoder = new TextEncoder();
    const abortController = new AbortController();
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pullCount++ === 0) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
            ),
          );
          return;
        }
        abortController.abort();
        const error = new Error('aborted');
        error.name = 'AbortError';
        controller.error(error);
      },
    });
    globalThis.fetch = vi.fn(
      async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    ) as typeof fetch;

    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: {
        id: 'local-model',
        provider: 'vllm',
        api: 'openai-completions',
        baseUrl: 'http://127.0.0.1:8000/v1',
        contextWindow: 4096,
        maxTokens: 256,
        reasoning: false,
        input: 'text',
      },
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
      signal: abortController.signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text', text: 'partial' },
      { type: 'done', finishReason: 'cancelled' },
    ]);
  });

  it('forwards explicit JSON-schema and reasoning controls without enabling unsupported tools', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;

    for await (const _event of plumbModelStream({
      model: {
        id: 'local-json-model',
        provider: 'vllm',
        api: 'openai-completions',
        baseUrl: 'http://127.0.0.1:8000/v1',
        contextWindow: 4096,
        maxTokens: 256,
        reasoning: true,
        toolsSupported: false,
        input: 'text',
      },
      messages: [{ role: 'user', content: 'respond as JSON' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'should_not_send',
            description: 'unsupported',
            parameters: { type: 'object' },
          },
        },
      ],
      apiKey: '',
      maxTokens: 123,
      temperature: 0.2,
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          strict: true,
          schema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
          },
        },
      },
      reasoningEffort: 'high',
    })) {
      // drain
    }

    expect(capturedBody).toMatchObject({
      max_tokens: 123,
      temperature: 0.2,
      reasoning_effort: 'high',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          strict: true,
        },
      },
    });
    expect(capturedBody).not.toHaveProperty('tools');
  });

  it('maps the same canonical image part to OpenAI and Anthropic wire formats', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBodies.push(JSON.parse(String(init?.body)));
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;
    const messages: PlumbStreamOptions['messages'] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          {
            type: 'image',
            imageUrl: 'data:image/png;base64,aW1hZ2U=',
            mimeType: 'image/png',
          },
        ],
      },
    ];

    for await (const _event of plumbModelStream({
      model: {
        id: 'openai-vision',
        provider: 'lm-studio',
        api: 'openai-completions',
        baseUrl: 'http://127.0.0.1:1234/v1',
        contextWindow: 4096,
        maxTokens: 256,
        reasoning: false,
        input: 'text+image',
      },
      messages,
      apiKey: '',
    })) {
      // drain
    }
    for await (const _event of plumbModelStream({
      model: {
        id: 'claude-vision',
        provider: 'anthropic-api',
        api: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com',
        contextWindow: 4096,
        maxTokens: 256,
        reasoning: false,
        input: 'text+image',
      },
      messages,
      apiKey: 'anthropic-test-key',
    })) {
      // drain
    }

    const openAiMessages = capturedBodies[0]?.['messages'] as Array<
      Record<string, unknown>
    >;
    expect(openAiMessages[0]?.['content']).toEqual([
      { type: 'text', text: 'describe' },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
      },
    ]);
    const anthropicMessages = capturedBodies[1]?.['messages'] as Array<
      Record<string, unknown>
    >;
    expect(anthropicMessages[0]?.['content']).toEqual([
      { type: 'text', text: 'describe' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'aW1hZ2U=',
        },
      },
    ]);
  });
});

describe('multi-turn tool-call/tool-result wire shape (regression: previously flattened to placeholder text, breaking every real multi-turn tool continuation)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const historyWithToolTurn: PlumbStreamOptions['messages'] = [
    { role: 'user', content: 'What files are in this repo?' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check.' },
        {
          type: 'tool_call',
          id: 'call_abc123',
          name: 'list_files',
          arguments: '{"path":"."}',
        },
      ],
    },
    {
      role: 'tool',
      toolCallId: 'call_abc123',
      name: 'list_files',
      content: [
        {
          type: 'tool_result',
          id: 'call_abc123',
          name: 'list_files',
          result: '["README.md","package.json"]',
        },
      ],
    },
    { role: 'user', content: 'Summarize them.' },
  ];

  const openaiToolModel: PlumbModel = {
    id: 'gpt-5.5',
    provider: 'openai',
    api: 'openai-completions',
    contextWindow: 128_000,
    maxTokens: 8_192,
    reasoning: false,
    input: 'text',
  };

  it('OpenAI-compatible: assistant tool_calls[] + a tool message with the matching tool_call_id', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(null, { status: 200, headers: {} });
    }) as typeof fetch;

    for await (const _e of plumbModelStream({
      model: openaiToolModel,
      messages: historyWithToolTurn,
      apiKey: 'sk-test',
    })) {
      // drain
    }

    const messages = capturedBody?.['messages'] as Array<
      Record<string, unknown>
    >;
    const assistantMsg = messages.find((m) => m['role'] === 'assistant');
    const toolMsg = messages.find((m) => m['role'] === 'tool');

    // The bug: previously `content: '[Tool: list_files]'` with no tool_calls
    // array, and a `tool` message with `tool_call_id: undefined` — a real
    // OpenAI-compatible endpoint rejects that outright (orphaned tool
    // message, no matching preceding tool_calls[].id).
    expect(assistantMsg?.['content']).not.toContain('[Tool:');
    expect(assistantMsg?.['tool_calls']).toEqual([
      {
        id: 'call_abc123',
        type: 'function',
        function: { name: 'list_files', arguments: '{"path":"."}' },
      },
    ]);
    expect(toolMsg?.['tool_call_id']).toBe('call_abc123');
    expect(toolMsg?.['content']).toBe('["README.md","package.json"]');
  });

  it('Anthropic: assistant tool_use block + a user message carrying a tool_result block (Anthropic has no tool role)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(null, { status: 200, headers: {} });
    }) as typeof fetch;

    const anthropicToolModel: PlumbModel = {
      id: 'claude-sonnet-5',
      provider: 'anthropic-api',
      api: 'anthropic-messages',
      contextWindow: 200_000,
      maxTokens: 8_192,
      reasoning: false,
      input: 'text',
    };

    for await (const _e of plumbModelStream({
      model: anthropicToolModel,
      messages: historyWithToolTurn,
      apiKey: 'sk-ant-test',
    })) {
      // drain
    }

    const messages = capturedBody?.['messages'] as Array<
      Record<string, unknown>
    >;
    const assistantMsg = messages.find((m) => m['role'] === 'assistant');
    const assistantBlocks = assistantMsg?.['content'] as Array<
      Record<string, unknown>
    >;
    const toolUseBlock = assistantBlocks.find((b) => b['type'] === 'tool_use');
    expect(toolUseBlock).toEqual({
      type: 'tool_use',
      id: 'call_abc123',
      name: 'list_files',
      input: { path: '.' },
    });

    // The tool result must be a `tool_result` block inside a *user* message
    // immediately following — Anthropic rejects a `tool`-role message.
    const toolResultMsg = messages.find(
      (m) =>
        m['role'] === 'user' &&
        Array.isArray(m['content']) &&
        (m['content'] as Array<Record<string, unknown>>).some(
          (b) => b['type'] === 'tool_result',
        ),
    );
    expect(toolResultMsg).toBeDefined();
    const toolResultBlock = (
      toolResultMsg!['content'] as Array<Record<string, unknown>>
    ).find((b) => b['type'] === 'tool_result');
    expect(toolResultBlock).toEqual({
      type: 'tool_result',
      tool_use_id: 'call_abc123',
      content: '["README.md","package.json"]',
    });
  });

  it('Gemini: functionCall/functionResponse parts with the matching id, never an empty Content', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(null, { status: 200, headers: {} });
    }) as typeof fetch;

    const geminiToolModel: PlumbModel = {
      id: 'gemini-3.1-pro-preview',
      provider: 'google',
      api: 'google-generative-ai',
      contextWindow: 1_000_000,
      maxTokens: 65_536,
      reasoning: true,
      input: 'text',
    };

    for await (const _e of plumbModelStream({
      model: geminiToolModel,
      messages: historyWithToolTurn,
      apiKey: 'AIza-test',
    })) {
      // drain
    }

    const contents = capturedBody?.['contents'] as Array<
      Record<string, unknown>
    >;
    for (const c of contents) {
      expect((c['parts'] as unknown[]).length).toBeGreaterThan(0);
    }
    const modelTurn = contents.find((c) => c['role'] === 'model');
    const functionCallPart = (
      modelTurn?.['parts'] as Array<Record<string, unknown>>
    ).find((p) => 'functionCall' in p);
    expect(functionCallPart?.['functionCall']).toEqual({
      id: 'call_abc123',
      name: 'list_files',
      args: { path: '.' },
    });

    const functionResponseTurn = contents.find((c) =>
      (c['parts'] as Array<Record<string, unknown>>).some(
        (p) => 'functionResponse' in p,
      ),
    );
    const functionResponsePart = (
      functionResponseTurn?.['parts'] as Array<Record<string, unknown>>
    ).find((p) => 'functionResponse' in p);
    expect(
      (functionResponsePart?.['functionResponse'] as Record<string, unknown>)[
        'id'
      ],
    ).toBe('call_abc123');
  });
});

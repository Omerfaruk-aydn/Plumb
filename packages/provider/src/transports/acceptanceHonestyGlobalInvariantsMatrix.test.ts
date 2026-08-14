/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { PlumbModelRegistry } from '../registry/model-registry.js';
import { plumbModelStream } from './streaming.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';
import { __resetVertexTokenCache } from '../vendor-ai/providers/plumbGoogleAuth.js';
import { __resetWatsonxClientCacheForTests } from './watsonx.js';
import { registerPlumbCredentialStoreFactory } from '../auth/credential-store.js';
import { __resetCustomProviderDefinitionsForTests } from '../config/customProviderDefinitions.js';
import type { PlumbStreamEvent, PlumbModel } from '../types.js';

async function drain(
  model: PlumbModel,
  apiKey?: string,
): Promise<PlumbStreamEvent[]> {
  const events: PlumbStreamEvent[] = [];
  for await (const e of plumbModelStream({
    model,
    messages: [{ role: 'user', content: 'honesty test' }],
    apiKey: apiKey ?? '',
  })) {
    events.push(e);
  }
  return events;
}

describe('Task 10 — Acceptance Honesty Global Invariants Matrix', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let registry: PlumbModelRegistry;
  const ORIGINAL_ENV = { ...process.env };
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];

  beforeEach(async () => {
    const { installBunGlobal } = await import('../vendor-shims/bun-runtime.js');
    installBunGlobal();
    registry = new PlumbModelRegistry();
    calls.length = 0;
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();

    registerPlumbCredentialStoreFactory(async () => ({
      getCredentials: async () => [],
      getApiKey: async () => null,
      hasCredentials: async () => false,
      listAuthenticatedProviders: async () => [],
      storeCredential: async () => {},
      storeOAuthCredential: async () => {},
      storeApiKeyCredential: async () => {},
      removeCredentials: async () => {},
      removeCredential: async () => true,
      clearAll: async () => {},
      setProviderMetadata: async () => {},
      getProviderMetadata: async () => null,
      healthCheck: async () => ({ available: true, usingFallback: false }),
    }));

    fetchSpy = vi.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      const rawHeaders = init?.headers;
      const headers: Record<string, string> = {};
      if (rawHeaders instanceof Headers) {
        rawHeaders.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (rawHeaders) {
        Object.assign(headers, rawHeaders as Record<string, string>);
      }
      calls.push({ url: urlStr, headers });
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();
    __resetCustomProviderDefinitionsForTests();
  });

  it('1. Zero fallback silent success: Missing API key for OpenAI yields explicit error event, ZERO fetch', async () => {
    const model = registry.getModelsForProvider('openai')[0];
    const events = await drain(model, ''); // empty API key

    expect(calls).toHaveLength(0); // Fail-closed, zero fetch attempt
    expect(events.some((e) => e.type === 'error')).toBe(true);
    const errorEvent = events.find((e) => e.type === 'error') as any;
    expect(errorEvent.error.code).toBe('MISSING_CREDENTIAL');
  });

  it('2. Zero fallback auth bleed: Missing credentials for Antigravity fail-closed with error event, ZERO fallback to other tokens', async () => {
    const antigravityModel: PlumbModel = {
      id: 'gpt-oss-120b-medium',
      provider: 'google-antigravity',
      api: 'google-gemini-cli',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      input: 'text',
    };

    const events = await drain(antigravityModel, '');
    expect(calls).toHaveLength(0); // Fail-closed, zero fetch attempt
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('3. Zero misrouted custom provider calls: Unregistered custom provider fails closed without key, NEVER silent fallback', async () => {
    const invalidCustomModel: PlumbModel = {
      id: 'ghost-model',
      provider: 'custom:99999999-9999-4999-a999-999999999999',
      api: 'openai-completions',
      baseUrl: 'https://api.openai.com/v1',
      contextWindow: 4096,
      maxTokens: 1024,
      input: 'text',
    };

    const events = await drain(invalidCustomModel, '');
    expect(calls).toHaveLength(0); // Fail-closed, zero fetch to api.openai.com
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('4. Zero unauthenticated fallback to arbitrary endpoints: Authenticated provider requires non-empty key', async () => {
    const [model] = getCatalogModels('anthropic-api');
    const events = await drain(model, undefined);

    expect(calls).toHaveLength(0);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('5. Full fail-closed discipline: Server HTTP 401 returns explicit error stream event', async () => {
    fetchSpy.mockImplementationOnce(
      async (url: unknown, init?: RequestInit) => {
        const urlStr = String(url);
        const rawHeaders = init?.headers;
        const headers: Record<string, string> = {};
        if (rawHeaders instanceof Headers) {
          rawHeaders.forEach((value, key) => {
            headers[key] = value;
          });
        } else if (rawHeaders) {
          Object.assign(headers, rawHeaders as Record<string, string>);
        }
        calls.push({ url: urlStr, headers });
        return new Response(
          JSON.stringify({ error: { message: 'Invalid API key' } }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    );

    const model = registry.getModelsForProvider('openai')[0];
    const events = await drain(model, 'invalid-key-10');

    expect(calls).toHaveLength(1);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
});

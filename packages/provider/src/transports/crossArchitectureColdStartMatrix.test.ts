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
import {
  setCustomProviderDefinitions,
  __resetCustomProviderDefinitionsForTests,
  type CustomProviderDefinition,
} from '../config/customProviderDefinitions.js';
import type { PlumbStreamEvent, PlumbModel } from '../types.js';

const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

function header(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

async function drain(
  model: PlumbModel,
  apiKey?: string,
): Promise<PlumbStreamEvent[]> {
  const events: PlumbStreamEvent[] = [];
  for await (const e of plumbModelStream({
    model,
    messages: [{ role: 'user', content: 'cold start test' }],
    apiKey: apiKey ?? '',
  })) {
    events.push(e);
  }
  return events;
}

describe('Task 7 — Cross-Architecture Cold Start Matrix', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const ORIGINAL_ENV = { ...process.env };
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
  }> = [];

  const CUSTOM_ID = 'custom:77777777-7777-4777-a777-777777777777';
  const CUSTOM_DEFS: CustomProviderDefinition[] = [
    {
      version: 1,
      id: CUSTOM_ID,
      displayName: 'Cold Start Custom',
      dialect: 'openai-completions',
      baseUrl: 'https://coldstart-custom.example.test/v1',
      credentialPlacement: 'bearer',
      safeHeaders: { 'X-Tenant': 'coldstart-7' },
      manualModels: [{ id: 'custom-model-7' }],
    },
  ];

  beforeEach(async () => {
    const { installBunGlobal } = await import('../vendor-shims/bun-runtime.js');
    installBunGlobal();
    calls.length = 0;
    mockQuery.mockReset();
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();

    registerPlumbCredentialStoreFactory(async () => ({
      getCredentials: async (p: string) => [
        {
          id: 'test-oauth-7',
          provider: p,
          credential: {
            type: 'oauth' as const,
            provider: p,
            access: 'oauth-token-7',
            refresh: 'oauth-refresh-7',
            expires: Date.now() + 3600000,
            projectId: 'project-7',
          },
          addedAt: Date.now(),
          lastUsedAt: Date.now(),
        },
      ],
      getApiKey: async () => 'key-7',
      hasCredentials: async () => true,
      listAuthenticatedProviders: async () => [
        'antigravity',
        'google-antigravity',
      ],
      storeCredential: async () => {},
      storeOAuthCredential: async () => {},
      storeApiKeyCredential: async () => {},
      removeCredentials: async () => {},
      removeCredential: async () => true,
      clearAll: async () => {},
      setProviderMetadata: async () => {},
      getProviderMetadata: async () => ({
        accountLabels: ['test'],
        credentialRefs: ['test-oauth-7'],
      }),
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

  it('1. API KEY architecture cold start (FIRST request after hydration)', async () => {
    const registry = new PlumbModelRegistry();
    const model = registry.getModelsForProvider('openai')[0];
    expect(model).toBeDefined();

    const events = await drain(model, 'api-key-coldstart-1');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('api.openai.com');
    expect(header(calls[0].headers, 'authorization')).toBe(
      'Bearer api-key-coldstart-1',
    );
  });

  it('2. OAUTH architecture cold start (FIRST request after hydration)', async () => {
    const registry = new PlumbModelRegistry();
    const model = registry.getModelsForProvider('antigravity')[0] ?? {
      id: 'gpt-oss-120b-medium',
      provider: 'google-antigravity',
      api: 'google-gemini-cli',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      input: 'text',
    };

    const events = await drain(model, '<authenticated>');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('googleapis.com');
    expect(header(calls[0].headers, 'authorization')).toBe(
      'Bearer oauth-token-7',
    );
  });

  it('3. SUBSCRIPTION architecture cold start (Claude Subscription Agent SDK boundary)', async () => {
    const [model] = getCatalogModels('claude-subscription');
    expect(model).toBeDefined();

    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: 'text', text: 'cold start sdk response' };
      })(),
    );

    const events = await drain(model, '<authenticated>');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(calls).toHaveLength(0); // SDK used directly, zero fetch
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('4. CODING PLAN architecture cold start (opencode-go / coding plan provider)', async () => {
    const model: PlumbModel = {
      id: 'opencode-default',
      provider: 'opencode-go',
      api: 'openai-completions',
      baseUrl: 'https://opencode.ai/api/v1',
      contextWindow: 128000,
      maxTokens: 4096,
      input: 'text',
    };

    const events = await drain(model, 'coding-plan-key-7');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('opencode.ai');
    expect(header(calls[0].headers, 'authorization')).toBe(
      'Bearer coding-plan-key-7',
    );
  });

  it('5. CLOUD architecture cold start (Azure deployment resolution on FIRST request)', async () => {
    process.env['AZURE_OPENAI_RESOURCE_NAME'] = 'coldstart-azure-res';
    const [model] = getCatalogModels('azure');
    expect(model).toBeDefined();

    const events = await drain(model, 'azure-key-coldstart');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('coldstart-azure-res.openai.azure.com');
    expect(header(calls[0].headers, 'api-key')).toBe('azure-key-coldstart');
  });

  it('6. LOCAL architecture cold start (Ollama server sweep on FIRST request)', async () => {
    const ollamaModel: PlumbModel = {
      id: 'llama3:8b',
      provider: 'ollama',
      api: 'ollama-chat',
      baseUrl: 'http://127.0.0.1:11434/v1',
      contextWindow: 8192,
      maxTokens: 4096,
      input: 'text',
    };

    const events = await drain(ollamaModel, '');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('127.0.0.1:11434');
    expect(header(calls[0].headers, 'authorization')).toBeUndefined();
  });

  it('7. GATEWAY architecture cold start (OpenRouter gateway routing on FIRST request)', async () => {
    const registry = new PlumbModelRegistry();
    const model = registry.getModelsForProvider('openrouter')[0] ?? {
      id: 'openrouter/auto',
      provider: 'openrouter',
      api: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      contextWindow: 128000,
      maxTokens: 4096,
      input: 'text',
    };

    const events = await drain(model, 'openrouter-key-coldstart');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('openrouter.ai');
    expect(header(calls[0].headers, 'authorization')).toBe(
      'Bearer openrouter-key-coldstart',
    );
  });

  it('8. CUSTOM architecture cold start (hydrated custom definitions on FIRST request)', async () => {
    setCustomProviderDefinitions(CUSTOM_DEFS);
    const registry = new PlumbModelRegistry();
    registry.hydrateCustomProviderModels();

    const model = registry.findModel(CUSTOM_ID, 'custom-model-7');
    expect(model).toBeDefined();

    const events = await drain(model!, 'custom-key-coldstart');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('coldstart-custom.example.test');
    expect(header(calls[0].headers, 'x-tenant')).toBe('coldstart-7');
  });
});

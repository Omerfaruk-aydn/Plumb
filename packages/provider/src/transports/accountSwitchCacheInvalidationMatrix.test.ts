/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 12 Account Switch & Cache Invalidation Matrix:
 * Proves immediate cache invalidation and zero residual state across:
 * 1. Vertex ADC / GCP project switch
 * 2. watsonx project switch
 * 3. Azure resource/deployment switch
 * 4. OAuth token switch
 * 5. Custom provider definition update switch
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { PlumbModelRegistry } from '../registry/model-registry.js';
import { plumbModelStream } from './streaming.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';
import { __resetVertexTokenCache } from '../omp-ai/providers/google-auth.js';
import { __resetWatsonxClientCacheForTests } from './watsonx.js';
import { registerPlumbCredentialStoreFactory } from '../auth/credential-store.js';
import {
  setCustomProviderDefinitions,
  __resetCustomProviderDefinitionsForTests,
  type CustomProviderDefinition,
} from '../config/customProviderDefinitions.js';
import type {
  PlumbStreamEvent,
  PlumbModel,
  PlumbOAuthCredential,
} from '../types.js';

const mockTextChatStream = vi.fn();
vi.mock('@ibm-cloud/watsonx-ai', () => ({
  WatsonXAI: {
    newInstance: () => ({
      textChatStream: (...a: unknown[]) => mockTextChatStream(...a),
    }),
  },
}));
vi.mock('ibm-cloud-sdk-core', () => ({
  IamAuthenticator: class {
    private apiKey: string;
    constructor(options: { apikey: string }) {
      this.apiKey = options.apikey;
    }
  },
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
    messages: [{ role: 'user', content: 'account switch test' }],
    apiKey: apiKey ?? '',
  })) {
    events.push(e);
  }
  return events;
}

describe('Task 12 — Account Switch & Cache Invalidation Matrix', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let registry: PlumbModelRegistry;
  let dynamicOAuthToken = 'oauth-token-account-A';
  const ORIGINAL_ENV = { ...process.env };
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];

  const CUSTOM_ID = 'custom:12121212-1212-4212-a212-121212121212';

  beforeEach(async () => {
    const { installBunGlobal } = await import('../omp-shims/bun-runtime.js');
    installBunGlobal();
    registry = new PlumbModelRegistry();
    calls.length = 0;
    mockTextChatStream.mockReset();
    dynamicOAuthToken = 'oauth-token-account-A';
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();

    registerPlumbCredentialStoreFactory(async () => ({
      getCredentials: async (p: string) => [
        {
          id: 'test-oauth-12',
          provider: p,
          credential: {
            type: 'oauth' as const,
            provider: p,
            access: dynamicOAuthToken,
            refresh: 'oauth-refresh-12',
            expires: Date.now() + 3600000,
            projectId: 'project-12',
          } as PlumbOAuthCredential,
          addedAt: Date.now(),
          lastUsedAt: Date.now(),
        },
      ],
      getApiKey: async () => 'key-12',
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
        credentialRefs: ['test-oauth-12'],
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

  it('1. Vertex ADC / GCP project switch: changing GOOGLE_CLOUD_PROJECT immediately updates endpoint URL', async () => {
    process.env['GOOGLE_CLOUD_LOCATION'] = 'us-central1';
    process.env['GOOGLE_CLOUD_ACCESS_TOKEN'] = 'vertex-token-12';

    const vertexModels = getCatalogModels('google-vertex');
    const vertexModel = vertexModels.find(
      (m) => m.api === 'anthropic-messages',
    )!;

    // Account A
    process.env['GOOGLE_CLOUD_PROJECT'] = 'gcp-project-alpha';
    await drain(vertexModel, '<authenticated>');
    expect(calls[0].url).toContain('gcp-project-alpha');

    // Account Switch to Project B
    __resetVertexTokenCache();
    process.env['GOOGLE_CLOUD_PROJECT'] = 'gcp-project-beta';
    await drain(vertexModel, '<authenticated>');

    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('gcp-project-beta');
    expect(calls[1].url).not.toContain('gcp-project-alpha');
  });

  it('2. watsonx project switch: changing WATSONX_PROJECT_ID immediately updates client project ID', async () => {
    const [watsonxModel] = getCatalogModels('watsonx');
    mockTextChatStream.mockResolvedValue(
      (async function* () {
        yield { data: { choices: [{ delta: { content: 'ok' } }] } };
      })(),
    );

    // Account A
    process.env['WATSONX_PROJECT_ID'] = 'watsonx-project-AAA';
    await drain(watsonxModel, 'watsonx-key-12');
    expect(mockTextChatStream.mock.calls[0][0].projectId).toBe(
      'watsonx-project-AAA',
    );

    // Account Switch to Project B
    __resetWatsonxClientCacheForTests();
    process.env['WATSONX_PROJECT_ID'] = 'watsonx-project-BBB';
    await drain(watsonxModel, 'watsonx-key-12');
    expect(mockTextChatStream.mock.calls[1][0].projectId).toBe(
      'watsonx-project-BBB',
    );
  });

  it('3. Azure resource switch: changing AZURE_OPENAI_RESOURCE_NAME immediately updates hostname', async () => {
    const [azureModel] = getCatalogModels('azure');

    // Resource A
    process.env['AZURE_OPENAI_RESOURCE_NAME'] = 'azure-res-alpha';
    await drain(azureModel, 'azure-key-12');
    expect(calls[0].url).toContain('azure-res-alpha.openai.azure.com');

    // Switch to Resource B
    process.env['AZURE_OPENAI_RESOURCE_NAME'] = 'azure-res-beta';
    await drain(azureModel, 'azure-key-12');
    expect(calls[1].url).toContain('azure-res-beta.openai.azure.com');
    expect(calls[1].url).not.toContain('azure-res-alpha');
  });

  it('4. OAuth token switch: stored OAuth token change immediately updates Authorization header', async () => {
    const antigravityModel: PlumbModel = {
      id: 'gpt-oss-120b-medium',
      provider: 'google-antigravity',
      api: 'google-gemini-cli',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      input: 'text',
    };

    // Token Account A
    dynamicOAuthToken = 'token-account-AAA';
    await drain(antigravityModel, '<authenticated>');
    expect(header(calls[0].headers, 'authorization')).toBe(
      'Bearer token-account-AAA',
    );

    // Switch to Token Account B
    dynamicOAuthToken = 'token-account-BBB';
    await drain(antigravityModel, '<authenticated>');
    expect(header(calls[1].headers, 'authorization')).toBe(
      'Bearer token-account-BBB',
    );
    expect(header(calls[1].headers, 'authorization')).not.toContain('AAA');
  });

  it('5. Custom provider update switch: updating CustomProviderDefinition immediately updates baseUrl and headers', async () => {
    const def1: CustomProviderDefinition = {
      version: 1,
      id: CUSTOM_ID,
      displayName: 'Custom Provider v1',
      dialect: 'openai-completions',
      baseUrl: 'https://custom-v1.example.test/v1',
      credentialPlacement: 'bearer',
      safeHeaders: { 'X-Tenant': 'v1' },
      manualModels: [{ id: 'custom-model-12' }],
    };

    // v1 Configuration
    setCustomProviderDefinitions([def1]);
    registry.hydrateCustomProviderModels();
    let customModel = registry.findModel(CUSTOM_ID, 'custom-model-12')!;

    await drain(customModel, 'key-12');
    expect(calls[0].url).toContain('custom-v1.example.test');
    expect(header(calls[0].headers, 'x-tenant')).toBe('v1');

    // Switch to v2 Configuration
    const def2: CustomProviderDefinition = {
      version: 1,
      id: CUSTOM_ID,
      displayName: 'Custom Provider v2',
      dialect: 'openai-completions',
      baseUrl: 'https://custom-v2.example.test/v1',
      credentialPlacement: 'bearer',
      safeHeaders: { 'X-Tenant': 'v2' },
      manualModels: [{ id: 'custom-model-12' }],
    };

    setCustomProviderDefinitions([def2]);
    registry = new PlumbModelRegistry();
    registry.hydrateCustomProviderModels();
    customModel = registry.findModel(CUSTOM_ID, 'custom-model-12')!;

    await drain(customModel, 'key-12');
    expect(calls[1].url).toContain('custom-v2.example.test');
    expect(header(calls[1].headers, 'x-tenant')).toBe('v2');
    expect(calls[1].url).not.toContain('custom-v1');
  });
});

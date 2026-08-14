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
import type { PlumbStreamEvent, PlumbModel } from '../types.js';

const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

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
    messages: [{ role: 'user', content: 'hello canary test' }],
    apiKey: apiKey ?? '',
  })) {
    events.push(e);
  }
  return events;
}

describe('Task 4 — Global Credential Authority Bleed Matrix', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let registry: PlumbModelRegistry;
  const ORIGINAL_ENV = { ...process.env };
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];

  const CANARY_OPENAI = 'PLUMB_TEST_OPENAI_SECRET_CANARY_4A';
  const CANARY_ANTHROPIC = 'PLUMB_TEST_ANTHROPIC_SECRET_CANARY_4B';
  const CANARY_GEMINI = 'PLUMB_TEST_GEMINI_SECRET_CANARY_4C';

  const CANARY_AWS_KEY = 'AKIA_PLUMB_BEDROCK_CANARY_4D';
  const CANARY_AWS_SECRET = 'PLUMB_TEST_AWS_SECRET_CANARY_4D';

  const CANARY_AZURE_KEY = 'PLUMB_TEST_AZURE_SECRET_CANARY_4E';
  const CANARY_VERTEX_TOKEN = 'PLUMB_TEST_VERTEX_TOKEN_CANARY_4F';
  const CANARY_WATSONX_KEY = 'PLUMB_TEST_WATSONX_SECRET_CANARY_4G';
  const CANARY_OCI_KEY = 'PLUMB_TEST_OCI_SECRET_CANARY_4H';

  const CANARY_PORTKEY_KEY = 'PLUMB_TEST_PORTKEY_SECRET_CANARY_4I';
  const CANARY_OPENROUTER_KEY = 'PLUMB_TEST_OPENROUTER_SECRET_CANARY_4J';

  beforeEach(async () => {
    const { installBunGlobal } = await import('../vendor-shims/bun-runtime.js');
    installBunGlobal();
    registry = new PlumbModelRegistry();
    calls.length = 0;
    mockQuery.mockReset();
    mockTextChatStream.mockReset();
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();

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
  });

  it('Matrix A: Direct API Key Authority Isolation (OpenAI / Anthropic / Gemini)', async () => {
    const openaiModel = registry.getModelsForProvider('openai')[0];
    const anthropicModel = registry.getModelsForProvider('anthropic-api')[0];
    const geminiModel = registry.getModelsForProvider('google')[0];

    // 1. OpenAI Call
    await drain(openaiModel, CANARY_OPENAI);
    expect(calls).toHaveLength(1);
    expect(header(calls[0].headers, 'authorization')).toBe(
      `Bearer ${CANARY_OPENAI}`,
    );
    expect(header(calls[0].headers, 'x-api-key')).toBeUndefined();
    expect(header(calls[0].headers, 'x-goog-api-key')).toBeUndefined();

    // 2. Anthropic Call
    await drain(anthropicModel, CANARY_ANTHROPIC);
    expect(calls).toHaveLength(2);
    expect(header(calls[1].headers, 'x-api-key')).toBe(CANARY_ANTHROPIC);
    expect(header(calls[1].headers, 'authorization')).toBeUndefined();
    expect(header(calls[1].headers, 'x-goog-api-key')).toBeUndefined();

    // 3. Gemini Call
    await drain(geminiModel, CANARY_GEMINI);
    expect(calls).toHaveLength(3);
    const geminiHeaderKey = header(calls[2].headers, 'x-goog-api-key');
    const geminiUrlKey = calls[2].url.includes(`key=${CANARY_GEMINI}`);
    expect(geminiHeaderKey === CANARY_GEMINI || geminiUrlKey).toBe(true);
    expect(header(calls[2].headers, 'authorization')).toBeUndefined();
    expect(header(calls[2].headers, 'x-api-key')).toBeUndefined();
  });

  it('Matrix B: Cloud Provider Authority Isolation (Bedrock / Azure / Vertex / watsonx / OCI)', async () => {
    const [bedrockModel] = getCatalogModels('amazon-bedrock');
    const [azureModel] = getCatalogModels('azure');
    const vertexModels = getCatalogModels('google-vertex');
    const vertexModel = vertexModels.find(
      (m) => m.api === 'anthropic-messages',
    )!;
    const [watsonxModel] = getCatalogModels('watsonx');
    const [ociModel] = getCatalogModels('oci-genai');

    // Bedrock AWS SigV4
    process.env['AWS_ACCESS_KEY_ID'] = CANARY_AWS_KEY;
    process.env['AWS_SECRET_ACCESS_KEY'] = CANARY_AWS_SECRET;
    process.env['AWS_REGION'] = 'us-east-1';
    await drain(bedrockModel, '<authenticated>');
    expect(calls).toHaveLength(1);
    expect(header(calls[0].headers, 'authorization')).toMatch(
      /^AWS4-HMAC-SHA256 /,
    );
    expect(calls[0].headers['authorization']).toContain(CANARY_AWS_KEY);

    // Azure api-key header
    process.env['AZURE_OPENAI_RESOURCE_NAME'] = 'test-azure-res';
    await drain(azureModel, CANARY_AZURE_KEY);
    expect(calls).toHaveLength(2);
    expect(header(calls[1].headers, 'api-key')).toBe(CANARY_AZURE_KEY);
    expect(header(calls[1].headers, 'authorization')).toBeUndefined();

    // Vertex OAuth Bearer token
    process.env['GOOGLE_CLOUD_PROJECT'] = 'vertex-project-4b';
    process.env['GOOGLE_CLOUD_LOCATION'] = 'us-central1';
    process.env['GOOGLE_CLOUD_ACCESS_TOKEN'] = CANARY_VERTEX_TOKEN;
    await drain(vertexModel, '<authenticated>');
    expect(calls).toHaveLength(3);
    expect(header(calls[2].headers, 'authorization')).toBe(
      `Bearer ${CANARY_VERTEX_TOKEN}`,
    );
    expect(header(calls[2].headers, 'x-api-key')).toBeUndefined();

    // watsonx IAM Authenticator (SDK boundary)
    process.env['WATSONX_PROJECT_ID'] = 'watsonx-proj-4b';
    mockTextChatStream.mockResolvedValue(
      (async function* () {
        yield { data: { choices: [{ delta: { content: 'watsonx' } }] } };
      })(),
    );
    await drain(watsonxModel, CANARY_WATSONX_KEY);
    expect(mockTextChatStream).toHaveBeenCalledTimes(1);

    // OCI GenAI API Key
    process.env['OCI_REGION'] = 'us-ashburn-1';
    process.env['OCI_COMPARTMENT_ID'] = 'ocid1.compartment.oc1..4b';
    await drain(ociModel, CANARY_OCI_KEY);
    expect(calls).toHaveLength(4);
    expect(header(calls[3].headers, 'authorization')).toBe(
      `Bearer ${CANARY_OCI_KEY}`,
    );
  });

  it('Matrix C: Local vs Authenticated Authority Boundaries (Ollama / Antigravity)', async () => {
    const ollamaModel: PlumbModel = {
      id: 'llama3:8b',
      provider: 'ollama',
      api: 'ollama-chat',
      baseUrl: 'http://127.0.0.1:11434/v1',
      contextWindow: 8192,
      maxTokens: 4096,
      input: 'text',
    };
    const antigravityModel: PlumbModel = {
      id: 'gpt-oss-120b-medium',
      provider: 'google-antigravity',
      api: 'google-gemini-cli',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      input: 'text',
    };

    registerPlumbCredentialStoreFactory(async () => ({
      getCredentials: async (p: string) => [
        {
          id: 'test-oauth',
          provider: p,
          credential: {
            type: 'oauth' as const,
            provider: p,
            access: 'ANTIGRAVITY_CANARY_OAUTH_TOKEN_4C',
            refresh: 'refresh-token',
            expires: Date.now() + 3600000,
            projectId: 'project-4c',
          },
          addedAt: Date.now(),
          lastUsedAt: Date.now(),
        },
      ],
      getApiKey: async () => 'api-key-4c',
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
        credentialRefs: ['test-oauth'],
      }),
      healthCheck: async () => ({ available: true, usingFallback: false }),
    }));

    // 1. Ollama (No Auth)
    await drain(ollamaModel, '');
    expect(calls).toHaveLength(1);
    expect(header(calls[0].headers, 'authorization')).toBeUndefined();

    // 2. Antigravity (OAuth Authority)
    await drain(antigravityModel, '<authenticated>');
    expect(calls).toHaveLength(2);
    expect(header(calls[1].headers, 'authorization')).toBe(
      'Bearer ANTIGRAVITY_CANARY_OAUTH_TOKEN_4C',
    );
  });

  it('Matrix D: Gateway Authority Isolation (Portkey / OpenRouter)', async () => {
    const portkeyModel: PlumbModel = {
      id: 'gpt-4o',
      provider: 'portkey',
      api: 'openai-completions',
      baseUrl: 'https://api.portkey.ai/v1',
      headers: { 'x-portkey-api-key': CANARY_PORTKEY_KEY },
      contextWindow: 128000,
      maxTokens: 4096,
      input: 'text',
    };
    const openrouterModel = registry.getModelsForProvider('openrouter')[0] ?? {
      id: 'openrouter/auto',
      provider: 'openrouter',
      api: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      contextWindow: 128000,
      maxTokens: 4096,
      input: 'text',
    };

    await drain(portkeyModel, CANARY_PORTKEY_KEY);
    expect(calls).toHaveLength(1);
    expect(header(calls[0].headers, 'x-portkey-api-key')).toBe(
      CANARY_PORTKEY_KEY,
    );
    expect(header(calls[0].headers, 'authorization')).toBeUndefined();

    await drain(openrouterModel, CANARY_OPENROUTER_KEY);
    expect(calls).toHaveLength(2);
    expect(header(calls[1].headers, 'authorization')).toBe(
      `Bearer ${CANARY_OPENROUTER_KEY}`,
    );
    expect(header(calls[1].headers, 'x-portkey-api-key')).toBeUndefined();
  });
});

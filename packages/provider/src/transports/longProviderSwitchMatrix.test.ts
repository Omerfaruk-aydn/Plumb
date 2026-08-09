/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 6 Long Provider Switch Matrix:
 * Exercises 19 distinct provider authorities across coherent switch chains
 * asserting zero state leak, zero authority bleed, and zero residual headers
 * on round-trip returning to initial providers.
 *
 * Included Authorities:
 * 1. OpenAI
 * 2. Anthropic
 * 3. Gemini
 * 4. GitHub Copilot
 * 5. Claude Subscription (SDK boundary)
 * 6. Antigravity
 * 7. Bedrock
 * 8. Azure
 * 9. Vertex
 * 10. watsonx (SDK boundary)
 * 11. OCI
 * 12. Ollama
 * 13. LM Studio
 * 14. OpenRouter
 * 15. Portkey
 * 16. Cloudflare AI Gateway
 * 17. Custom OpenAI
 * 18. Custom Anthropic
 * 19. Custom Gemini
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
    messages: [{ role: 'user', content: 'long switch test' }],
    apiKey: apiKey ?? '',
  })) {
    events.push(e);
  }
  return events;
}

describe('Task 6 — Long Provider Switch Matrix', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let registry: PlumbModelRegistry;
  const ORIGINAL_ENV = { ...process.env };
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
  }> = [];

  const CUSTOM_OPENAI_ID = 'custom:11111111-1111-4111-a111-111111111111';
  const CUSTOM_ANTHROPIC_ID = 'custom:22222222-2222-4222-a222-222222222222';
  const CUSTOM_GEMINI_ID = 'custom:33333333-3333-4333-a333-333333333333';

  const CUSTOM_DEFINITIONS: CustomProviderDefinition[] = [
    {
      version: 1,
      id: CUSTOM_OPENAI_ID,
      displayName: 'Custom OpenAI 6',
      dialect: 'openai-completions',
      baseUrl: 'https://custom-openai-6.example.test/v1',
      credentialPlacement: 'bearer',
      safeHeaders: { 'X-Custom-Tenant': 'c6-openai' },
      manualModels: [{ id: 'custom-gpt-6' }],
    },
    {
      version: 1,
      id: CUSTOM_ANTHROPIC_ID,
      displayName: 'Custom Anthropic 6',
      dialect: 'anthropic-messages',
      baseUrl: 'https://custom-anthropic-6.example.test',
      credentialPlacement: 'x-api-key',
      safeHeaders: { 'X-Custom-Tenant': 'c6-anthropic' },
      manualModels: [{ id: 'custom-claude-6' }],
    },
    {
      version: 1,
      id: CUSTOM_GEMINI_ID,
      displayName: 'Custom Gemini 6',
      dialect: 'google-generative-ai',
      baseUrl: 'https://custom-gemini-6.example.test/v1beta',
      credentialPlacement: 'query-key',
      safeHeaders: { 'X-Custom-Tenant': 'c6-gemini' },
      manualModels: [{ id: 'custom-gemini-6' }],
    },
  ];

  beforeEach(async () => {
    const { installBunGlobal } = await import('../omp-shims/bun-runtime.js');
    installBunGlobal();
    registry = new PlumbModelRegistry();
    setCustomProviderDefinitions(CUSTOM_DEFINITIONS);
    registry.hydrateCustomProviderModels();

    registerPlumbCredentialStoreFactory(async () => ({
      getCredentials: async (p: string) => [
        {
          id: 'test-oauth',
          provider: p,
          credential: {
            type: 'oauth' as const,
            provider: p,
            access: 'antigravity-mock-token',
            refresh: 'antigravity-refresh-token',
            expires: Date.now() + 3600000,
            projectId: 'mock-antigravity-project',
          },
          addedAt: Date.now(),
          lastUsedAt: Date.now(),
        },
      ],
      getApiKey: async () => 'mock-key-6',
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

    calls.length = 0;
    mockQuery.mockReset();
    mockTextChatStream.mockReset();
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();

    process.env['AWS_ACCESS_KEY_ID'] = 'AKIA_LONG_SWITCH_6';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'AWS_SECRET_LONG_SWITCH_6';
    process.env['AWS_REGION'] = 'us-east-1';

    process.env['AZURE_OPENAI_RESOURCE_NAME'] = 'azure-res-6';

    process.env['GOOGLE_CLOUD_PROJECT'] = 'vertex-proj-6';
    process.env['GOOGLE_CLOUD_LOCATION'] = 'us-central1';
    process.env['GOOGLE_CLOUD_ACCESS_TOKEN'] = 'vertex-tok-6';

    process.env['WATSONX_PROJECT_ID'] = 'watsonx-p-6';

    process.env['OCI_REGION'] = 'us-ashburn-1';
    process.env['OCI_COMPARTMENT_ID'] = 'ocid1.compartment.oc1..ashburn-6';

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

  it('Chain 1: OpenAI -> Anthropic -> Gemini -> GitHub Copilot -> Claude Subscription -> Antigravity -> OpenAI', async () => {
    const openaiModel = registry.getModelsForProvider('openai')[0];
    const anthropicModel = registry.getModelsForProvider('anthropic-api')[0];
    const geminiModel = registry.getModelsForProvider('google')[0];
    const copilotModel = registry.getModelsForProvider('github-copilot')[0] ?? {
      id: 'gpt-4o',
      provider: 'github-copilot',
      api: 'openai-completions',
      baseUrl: 'https://api.githubcopilot.com',
      contextWindow: 128000,
      maxTokens: 4096,
      input: 'text',
    };
    const [claudeSubModel] = getCatalogModels('claude-subscription');
    const antigravityModel: PlumbModel = {
      id: 'gpt-oss-120b-medium',
      provider: 'google-antigravity',
      api: 'google-gemini-cli',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      input: 'text',
    };

    // 1. OpenAI
    await drain(openaiModel, 'key-openai-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('api.openai.com');
    expect(header(calls[0].headers, 'authorization')).toBe(
      'Bearer key-openai-1',
    );

    // 2. Anthropic
    await drain(anthropicModel, 'key-anthropic-1');
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('api.anthropic.com');
    expect(header(calls[1].headers, 'x-api-key')).toBe('key-anthropic-1');
    expect(header(calls[1].headers, 'authorization')).toBeUndefined();

    // 3. Gemini
    await drain(geminiModel, 'key-gemini-1');
    expect(calls).toHaveLength(3);
    expect(calls[2].url).toContain('googleapis.com');
    const geminiHeaderKey = header(calls[2].headers, 'x-goog-api-key');
    const geminiUrlKey = calls[2].url.includes('key=key-gemini-1');
    expect(geminiHeaderKey === 'key-gemini-1' || geminiUrlKey).toBe(true);

    // 4. Copilot
    await drain(copilotModel, 'key-copilot-1');
    expect(calls).toHaveLength(4);
    expect(calls[3].url).toContain('githubcopilot.com');
    expect(header(calls[3].headers, 'authorization')).toBe(
      'Bearer key-copilot-1',
    );

    // 5. Claude Subscription (SDK boundary, no fetch)
    const mockGenerator = (async function* () {
      yield { type: 'text', text: 'SDK response' };
    })();
    mockQuery.mockReturnValue(mockGenerator);
    await drain(claudeSubModel, '<authenticated>');
    expect(calls).toHaveLength(4); // fetch count unchanged
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // 6. Antigravity
    await drain(antigravityModel, '<authenticated>');
    expect(calls).toHaveLength(5);
    expect(calls[4].url).toContain('googleapis.com');

    // 7. OpenAI return (round-trip isolation check)
    await drain(openaiModel, 'key-openai-1');
    expect(calls).toHaveLength(6);
    expect(calls[5].url).toContain('api.openai.com');
    expect(header(calls[5].headers, 'authorization')).toBe(
      'Bearer key-openai-1',
    );
    expect(header(calls[5].headers, 'x-api-key')).toBeUndefined();
    expect(header(calls[5].headers, 'x-goog-api-key')).toBeUndefined();
  });

  it('Chain 2: Bedrock -> Azure -> Vertex -> watsonx -> OCI -> Bedrock', async () => {
    const [bedrockModel] = getCatalogModels('amazon-bedrock');
    const [azureModel] = getCatalogModels('azure');
    const vertexModels = getCatalogModels('google-vertex');
    const vertexModel = vertexModels.find(
      (m) => m.api === 'anthropic-messages',
    )!;
    const [watsonxModel] = getCatalogModels('watsonx');
    const [ociModel] = getCatalogModels('oci-genai');

    // 1. Bedrock
    await drain(bedrockModel, '<authenticated>');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('bedrock-runtime.us-east-1.amazonaws.com');
    expect(header(calls[0].headers, 'authorization')).toMatch(
      /^AWS4-HMAC-SHA256 /,
    );

    // 2. Azure
    await drain(azureModel, 'azure-k-6');
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('azure-res-6.openai.azure.com');
    expect(header(calls[1].headers, 'api-key')).toBe('azure-k-6');

    // 3. Vertex
    await drain(vertexModel, '<authenticated>');
    expect(calls).toHaveLength(3);
    expect(calls[2].url).toContain('us-central1-aiplatform.googleapis.com');
    expect(header(calls[2].headers, 'authorization')).toBe(
      'Bearer vertex-tok-6',
    );

    // 4. watsonx (SDK boundary)
    mockTextChatStream.mockResolvedValue(
      (async function* () {
        yield { data: { choices: [{ delta: { content: 'hi' } }] } };
      })(),
    );
    await drain(watsonxModel, 'watsonx-k-6');
    expect(calls).toHaveLength(3);
    expect(mockTextChatStream).toHaveBeenCalledTimes(1);

    // 5. OCI
    await drain(ociModel, 'oci-k-6');
    expect(calls).toHaveLength(4);
    expect(calls[3].url).toContain('oraclecloud.com');

    // 6. Bedrock return (round-trip isolation check)
    await drain(bedrockModel, '<authenticated>');
    expect(calls).toHaveLength(5);
    expect(calls[4].url).toContain('bedrock-runtime.us-east-1.amazonaws.com');
    expect(header(calls[4].headers, 'authorization')).toMatch(
      /^AWS4-HMAC-SHA256 /,
    );
    expect(header(calls[4].headers, 'api-key')).toBeUndefined();
  });

  it('Chain 3: Ollama -> LM Studio -> OpenRouter -> Portkey -> Cloudflare AI Gateway -> Custom OpenAI -> Custom Anthropic -> Custom Gemini -> Ollama', async () => {
    const ollamaModel: PlumbModel = {
      id: 'llama3:8b',
      provider: 'ollama',
      api: 'ollama-chat',
      baseUrl: 'http://127.0.0.1:11434/v1',
      contextWindow: 8192,
      maxTokens: 4096,
      input: 'text',
    };
    const lmStudioModel: PlumbModel = {
      id: 'local-model',
      provider: 'lm-studio',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:1234/v1',
      contextWindow: 8192,
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
    const portkeyModel: PlumbModel = {
      id: 'gpt-4o',
      provider: 'portkey',
      api: 'openai-completions',
      baseUrl: 'https://api.portkey.ai/v1',
      headers: { 'x-portkey-api-key': 'pk-key-6' },
      contextWindow: 128000,
      maxTokens: 4096,
      input: 'text',
    };
    const cfGatewayModel: PlumbModel = {
      id: '@cf/meta/llama-3-8b-instruct',
      provider: 'cloudflare-ai-gateway',
      api: 'openai-completions',
      baseUrl: 'https://gateway.ai.cloudflare.com/v1/cfacc6/cfgw6/openai',
      contextWindow: 8192,
      maxTokens: 4096,
      input: 'text',
    };

    const customOpenAI = registry.findModel(CUSTOM_OPENAI_ID, 'custom-gpt-6')!;
    const customAnthropic = registry.findModel(
      CUSTOM_ANTHROPIC_ID,
      'custom-claude-6',
    )!;
    const customGemini = registry.findModel(
      CUSTOM_GEMINI_ID,
      'custom-gemini-6',
    )!;

    // 1. Ollama
    await drain(ollamaModel, '');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('11434');

    // 2. LM Studio
    await drain(lmStudioModel, '');
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('1234');

    // 3. OpenRouter
    await drain(openrouterModel, 'or-k-6');
    expect(calls).toHaveLength(3);
    expect(calls[2].url).toContain('openrouter.ai');

    // 4. Portkey
    await drain(portkeyModel, 'pk-k-6');
    expect(calls).toHaveLength(4);
    expect(calls[3].url).toContain('portkey.ai');

    // 5. Cloudflare AI Gateway
    await drain(cfGatewayModel, 'cf-k-6');
    expect(calls).toHaveLength(5);
    expect(calls[4].url).toContain('gateway.ai.cloudflare.com');

    // 6. Custom OpenAI
    await drain(customOpenAI, 'c6-openai-key');
    expect(calls).toHaveLength(6);
    expect(calls[5].url).toContain('custom-openai-6.example.test');
    expect(header(calls[5].headers, 'x-custom-tenant')).toBe('c6-openai');

    // 7. Custom Anthropic
    await drain(customAnthropic, 'c6-anthropic-key');
    expect(calls).toHaveLength(7);
    expect(calls[6].url).toContain('custom-anthropic-6.example.test');
    expect(header(calls[6].headers, 'x-custom-tenant')).toBe('c6-anthropic');

    // 8. Custom Gemini
    await drain(customGemini, 'c6-gemini-key');
    expect(calls).toHaveLength(8);
    expect(calls[7].url).toContain('custom-gemini-6.example.test');
    expect(header(calls[7].headers, 'x-custom-tenant')).toBe('c6-gemini');

    // 9. Ollama return (round-trip isolation check)
    await drain(ollamaModel, '');
    expect(calls).toHaveLength(9);
    expect(calls[8].url).toContain('11434');
    expect(header(calls[8].headers, 'authorization')).toBeUndefined();
    expect(header(calls[8].headers, 'x-custom-tenant')).toBeUndefined();
  });
});

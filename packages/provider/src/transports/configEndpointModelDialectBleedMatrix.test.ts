/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 5 Config / Endpoint / Model / Dialect Bleed Matrix:
 * Exercises isolation across Cloud (Azure/Vertex/Bedrock/watsonx/OCI), Local,
 * and Gateway provider configuration & wire dialect boundaries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { PlumbModelRegistry } from '../registry/model-registry.js';
import { plumbModelStream } from './streaming.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';
import { __resetVertexTokenCache } from '../omp-ai/providers/google-auth.js';
import { __resetWatsonxClientCacheForTests } from './watsonx.js';
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
    messages: [{ role: 'user', content: 'hello bleed test' }],
    apiKey: apiKey ?? '',
  })) {
    events.push(e);
  }
  return events;
}

describe('Task 5 — Config / Endpoint / Model / Dialect Bleed Matrix', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let registry: PlumbModelRegistry;
  const ORIGINAL_ENV = { ...process.env };
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];

  const CUSTOM_ID_A = 'custom:11111111-1111-4111-a111-111111111111';
  const CUSTOM_ID_B = 'custom:22222222-2222-4222-a222-222222222222';

  const CUSTOM_DEFINITIONS: CustomProviderDefinition[] = [
    {
      version: 1,
      id: CUSTOM_ID_A,
      displayName: 'Custom Provider A',
      dialect: 'openai-completions',
      baseUrl: 'https://custom-a.example.test/v1',
      credentialPlacement: 'bearer',
      safeHeaders: { 'X-Custom-Tenant': 'tenant-alpha' },
      manualModels: [{ id: 'custom-gpt-4o' }],
    },
    {
      version: 1,
      id: CUSTOM_ID_B,
      displayName: 'Custom Provider B',
      dialect: 'anthropic-messages',
      baseUrl: 'https://custom-b.example.test',
      credentialPlacement: 'x-api-key',
      safeHeaders: { 'X-Custom-Tenant': 'tenant-beta' },
      manualModels: [{ id: 'custom-claude-3-5' }],
    },
  ];

  beforeEach(async () => {
    const { installBunGlobal } = await import('../omp-shims/bun-runtime.js');
    installBunGlobal();
    registry = new PlumbModelRegistry();
    setCustomProviderDefinitions(CUSTOM_DEFINITIONS);
    registry.hydrateCustomProviderModels();
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
    __resetCustomProviderDefinitionsForTests();
  });

  it('Matrix A: Cloud config isolation (Azure / Vertex / Bedrock / watsonx / OCI)', async () => {
    const [bedrockModel] = getCatalogModels('amazon-bedrock');
    const [azureModel] = getCatalogModels('azure');
    const vertexModels = getCatalogModels('google-vertex');
    const vertexModel = vertexModels.find(
      (m) => m.api === 'anthropic-messages',
    )!;
    const [watsonxModel] = getCatalogModels('watsonx');
    const [ociModel] = getCatalogModels('oci-genai');

    // 1. Bedrock with Region A
    process.env['AWS_ACCESS_KEY_ID'] = 'AKIA_BEDROCK_5';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'AWS_SECRET_BEDROCK_5';
    process.env['AWS_REGION'] = 'us-east-1';
    await drain(bedrockModel, '<authenticated>');
    expect(calls[0].url).toContain('bedrock-runtime.us-east-1.amazonaws.com');

    // 2. Azure with Resource B
    process.env['AZURE_OPENAI_RESOURCE_NAME'] = 'azure-res-test-5';
    await drain(azureModel, 'azure-key-5');
    expect(calls[1].url).toContain('azure-res-test-5.openai.azure.com');

    // 3. Vertex with Project C & Location C
    process.env['GOOGLE_CLOUD_PROJECT'] = 'vertex-project-5';
    process.env['GOOGLE_CLOUD_LOCATION'] = 'us-central1';
    process.env['GOOGLE_CLOUD_ACCESS_TOKEN'] = 'vertex-tok-5';
    await drain(vertexModel, '<authenticated>');
    expect(calls[2].url).toContain('us-central1-aiplatform.googleapis.com');
    expect(calls[2].url).toContain('vertex-project-5');

    // 4. watsonx with Project D
    process.env['WATSONX_PROJECT_ID'] = 'watsonx-project-id-5';
    mockTextChatStream.mockResolvedValue(
      (async function* () {
        yield { data: { choices: [{ delta: { content: 'hello' } }] } };
      })(),
    );
    await drain(watsonxModel, 'watsonx-key-5');
    expect(mockTextChatStream).toHaveBeenCalledTimes(1);

    // 5. OCI with Region E & Compartment E
    process.env['OCI_REGION'] = 'us-ashburn-1';
    process.env['OCI_COMPARTMENT_ID'] = 'ocid1.compartment.oc1..test5';
    await drain(ociModel, 'oci-key-5');
    expect(calls[3].url).toContain('oraclecloud.com');
  });

  it('Matrix B: Local vs External endpoint isolation (Ollama / LM Studio)', async () => {
    const ollamaModel: PlumbModel = {
      id: 'llama3:8b',
      provider: 'ollama',
      api: 'ollama-chat',
      baseUrl: 'http://127.0.0.1:11434/v1',
      contextWindow: 8192,
      maxTokens: 4096,
      input: 'text',
    };
    const externalModel = registry.getModelsForProvider('openai')[0];

    await drain(ollamaModel, '');
    expect(calls[0].url).toContain('127.0.0.1:11434');
    expect(header(calls[0].headers, 'authorization')).toBeUndefined();

    await drain(externalModel, 'key-openai-5');
    expect(calls[1].url).toContain('api.openai.com');
    expect(header(calls[1].headers, 'authorization')).toBe(
      'Bearer key-openai-5',
    );
  });

  it('Matrix C: Gateway routing isolation (OpenRouter / Portkey / Cloudflare AI Gateway)', async () => {
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
      headers: { 'x-portkey-api-key': 'pk-5' },
      contextWindow: 128000,
      maxTokens: 4096,
      input: 'text',
    };
    const cfGatewayModel: PlumbModel = {
      id: '@cf/meta/llama-3-8b-instruct',
      provider: 'cloudflare-ai-gateway',
      api: 'openai-completions',
      baseUrl: 'https://gateway.ai.cloudflare.com/v1/cfacc5/cfgw5/openai',
      contextWindow: 8192,
      maxTokens: 4096,
      input: 'text',
    };

    await drain(openrouterModel, 'or-key-5');
    expect(calls[0].url).toContain('openrouter.ai');

    await drain(portkeyModel, 'pk-key-5');
    expect(calls[1].url).toContain('portkey.ai');
    expect(header(calls[1].headers, 'x-portkey-api-key')).toBe('pk-key-5');

    await drain(cfGatewayModel, 'cf-key-5');
    expect(calls[2].url).toContain('gateway.ai.cloudflare.com');
    expect(calls[2].url).toContain('cfacc5/cfgw5');
  });

  it('Matrix D: Custom provider definition & header isolation', async () => {
    const customA = registry.findModel(CUSTOM_ID_A, 'custom-gpt-4o')!;
    const customB = registry.findModel(CUSTOM_ID_B, 'custom-claude-3-5')!;

    await drain(customA, 'key-custom-a');
    expect(calls[0].url).toContain('custom-a.example.test');
    expect(header(calls[0].headers, 'x-custom-tenant')).toBe('tenant-alpha');
    expect(header(calls[0].headers, 'authorization')).toBe(
      'Bearer key-custom-a',
    );

    await drain(customB, 'key-custom-b');
    expect(calls[1].url).toContain('custom-b.example.test');
    expect(header(calls[1].headers, 'x-custom-tenant')).toBe('tenant-beta');
    expect(header(calls[1].headers, 'x-api-key')).toBe('key-custom-b');
    expect(header(calls[1].headers, 'authorization')).toBeUndefined();
  });
});

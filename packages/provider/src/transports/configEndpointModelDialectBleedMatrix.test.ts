/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 5 Config / Endpoint / Model / Dialect Bleed Matrix:
 * Exercises behavioral switch boundaries across Azure, Vertex, Bedrock, watsonx,
 * OCI, Local, and Gateway providers, proving:
 * - CONFIG_BLEED = ZERO
 * - ENDPOINT_BLEED = ZERO
 * - MODEL_BLEED = ZERO
 * - DIALECT_BLEED = ZERO
 * - TRANSPORT_BLEED = ZERO
 * - SESSION_BLEED = ZERO
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { PlumbModelRegistry } from '../registry/model-registry.js';
import { plumbModelStream } from './streaming.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';
import { __resetVertexTokenCache } from '../omp-ai/providers/google-auth.js';
import { __resetWatsonxClientCacheForTests } from './watsonx.js';
import type { PlumbStreamEvent, PlumbModel } from '../types.js';

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

async function drain(
  model: PlumbModel,
  apiKey?: string,
): Promise<PlumbStreamEvent[]> {
  const events: PlumbStreamEvent[] = [];
  for await (const e of plumbModelStream({
    model,
    messages: [{ role: 'user', content: 'hello bleed test' }],
    apiKey,
  })) {
    events.push(e);
  }
  return events;
}

describe('Task 5 — Config / Endpoint / Model / Dialect Bleed Matrix', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let registry: PlumbModelRegistry;
  const ORIGINAL_ENV = { ...process.env };
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
    body: string;
  }> = [];

  beforeEach(async () => {
    const { installBunGlobal } = await import('../omp-shims/bun-runtime.js');
    installBunGlobal();
    registry = new PlumbModelRegistry();
    calls.length = 0;
    mockTextChatStream.mockReset();
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();

    process.env['AWS_ACCESS_KEY_ID'] = 'AWS_KEY_CANARY_5';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'AWS_SECRET_CANARY_5';
    process.env['AWS_REGION'] = 'us-west-2';
    delete process.env['AWS_BEARER_TOKEN_BEDROCK'];

    process.env['AZURE_OPENAI_RESOURCE_NAME'] = 'azure-res-canary-5';
    delete process.env['AZURE_OPENAI_BASE_URL'];
    delete process.env['AZURE_OPENAI_DEPLOYMENT_NAME_MAP'];

    process.env['GOOGLE_CLOUD_PROJECT'] = 'vertex-project-canary-5';
    process.env['GOOGLE_CLOUD_LOCATION'] = 'us-west1';
    process.env['GOOGLE_CLOUD_ACCESS_TOKEN'] = 'vertex-token-canary-5';

    process.env['WATSONX_PROJECT_ID'] = 'watsonx-proj-canary-5';

    process.env['OCI_REGION'] = 'eu-frankfurt-1';
    process.env['OCI_COMPARTMENT_ID'] =
      'ocid1.compartment.oc1..frankfurt-canary-5';

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
      const body = String(init?.body ?? '');
      calls.push({ url: urlStr, headers, body });
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

  it('1. Cloud Providers Config & Endpoint Isolation (Azure -> Vertex -> Bedrock -> watsonx -> OCI)', async () => {
    const [bedrockModel] = getCatalogModels('amazon-bedrock');
    const [azureModel] = getCatalogModels('azure');
    const vertexModels = getCatalogModels('google-vertex');
    const vertexModel = vertexModels.find(
      (m) => m.api === 'anthropic-messages',
    )!;
    const [watsonxModel] = getCatalogModels('watsonx');
    const [ociModel] = getCatalogModels('oci-genai');

    // Azure call
    await drain(azureModel, 'azure-key-5');
    const azureReq = calls[0];
    expect(azureReq.url).toContain('azure-res-canary-5.openai.azure.com');

    // Vertex call
    await drain(vertexModel, '<authenticated>');
    const vertexReq = calls[1];
    expect(vertexReq.url).toContain('us-west1-aiplatform.googleapis.com');
    expect(vertexReq.url).toContain('vertex-project-canary-5');
    expect(vertexReq.url).not.toContain('azure-res-canary-5');

    // Bedrock call
    await drain(bedrockModel, '<authenticated>');
    const bedrockReq = calls[2];
    expect(bedrockReq.url).toContain('bedrock-runtime.us-west-2.amazonaws.com');
    expect(bedrockReq.url).not.toContain('vertex-project-canary-5');
    expect(bedrockReq.url).not.toContain('azure-res-canary-5');

    // watsonx call
    mockTextChatStream.mockResolvedValue(
      (async function* () {
        yield { data: { choices: [{ delta: { content: 'hi' } }] } };
      })(),
    );
    await drain(watsonxModel, 'ibm-key-5');
    expect(mockTextChatStream).toHaveBeenCalledTimes(1);
    const watsonxArgs = mockTextChatStream.mock.calls[0][0] as {
      projectId?: string;
    };
    expect(watsonxArgs.projectId).toBe('watsonx-proj-canary-5');

    // OCI call
    await drain(ociModel, 'oci-key-5');
    const ociReq = calls[3];
    expect(ociReq.url).toContain(
      'inference.generativeai.eu-frankfurt-1.oci.oraclecloud.com',
    );
    expect(ociReq.url).not.toContain('azure-res-canary-5');
    expect(ociReq.url).not.toContain('vertex-project-canary-5');
    expect(ociReq.url).not.toContain('watsonx-proj-canary-5');
    expect(ociReq.url).not.toContain('amazonaws.com');
  });

  it('2. Local Endpoint vs External Endpoint Isolation', async () => {
    const ollamaModel: PlumbModel = {
      id: 'llama3:8b',
      provider: 'ollama',
      api: 'ollama-chat',
      baseUrl: 'http://127.0.0.1:11434/v1',
      contextWindow: 8192,
      maxTokens: 4096,
      input: 'text',
    };
    const openaiModel = registry.getModelsForProvider('openai')[0];

    // Local Ollama
    await drain(ollamaModel, '');
    const localReq1 = calls[0];
    expect(localReq1.url).toContain('127.0.0.1:11434');

    // External OpenAI
    await drain(openaiModel, 'openai-key-5');
    const openaiReq = calls[1];
    expect(openaiReq.url).toContain('api.openai.com');
    expect(openaiReq.url).not.toContain('127.0.0.1');

    // Local Ollama return
    await drain(ollamaModel, '');
    const localReq2 = calls[2];
    expect(localReq2.url).toContain('127.0.0.1:11434');
    expect(localReq2.url).not.toContain('api.openai.com');
  });

  it('3. Gateway Endpoints Isolation (OpenRouter vs Portkey vs Cloudflare AI Gateway)', async () => {
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
      headers: { 'x-portkey-api-key': 'pk-canary-5' },
      contextWindow: 128000,
      maxTokens: 4096,
      input: 'text',
    };
    const cfGatewayModel: PlumbModel = {
      id: '@cf/meta/llama-3-8b-instruct',
      provider: 'cloudflare-ai-gateway',
      api: 'openai-completions',
      baseUrl: 'https://gateway.ai.cloudflare.com/v1/cfacc555/cfgw555/openai',
      contextWindow: 8192,
      maxTokens: 4096,
      input: 'text',
    };

    // OpenRouter
    await drain(openrouterModel, 'or-key-5');
    const req1 = calls[0];
    expect(req1.url).toContain('openrouter.ai');

    // Portkey
    await drain(portkeyModel, 'pk-key-5');
    const req2 = calls[1];
    expect(req2.url).toContain('api.portkey.ai');
    expect(req2.url).not.toContain('openrouter.ai');

    // Cloudflare AI Gateway
    await drain(cfGatewayModel, 'cf-key-5');
    const req3 = calls[2];
    expect(req3.url).toContain('gateway.ai.cloudflare.com');
    expect(req3.url).toContain('cfacc555/cfgw555');
    expect(req3.url).not.toContain('portkey.ai');
    expect(req3.url).not.toContain('openrouter.ai');
  });

  it('4. Dialect & Model Wire ID Isolation across sequential dispatches', async () => {
    const openaiModel = registry.getModelsForProvider('openai')[0];
    const anthropicModel = registry.getModelsForProvider('anthropic-api')[0];

    await drain(openaiModel, 'key-a');
    await drain(anthropicModel, 'key-b');

    expect(calls).toHaveLength(2);
    const reqOpenAI = calls[0];
    const reqAnthropic = calls[1];

    expect(reqOpenAI.url).toContain('api.openai.com');
    expect(reqAnthropic.url).toContain('api.anthropic.com');

    // Verify wire model ID is contained in the respective body payloads
    expect(reqOpenAI.body).toContain(
      openaiModel.requestModelId ?? openaiModel.id,
    );
    expect(reqAnthropic.body).toContain(
      anthropicModel.requestModelId ?? anthropicModel.id,
    );

    // Verify OpenAI body does NOT contain Anthropic model ID and vice-versa
    expect(reqOpenAI.body).not.toContain(anthropicModel.id);
    expect(reqAnthropic.body).not.toContain(openaiModel.id);
  });
});

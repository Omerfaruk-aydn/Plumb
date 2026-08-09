/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 4 Global Credential Authority Bleed Matrix:
 * Exercises production dispatch boundaries (`plumbModelStream`) across
 * fundamentally different credential authority classes with unique secret
 * canaries, asserting zero credential bleed, zero auth header bleed, and zero
 * signer state bleed.
 *
 * Matrix A: Direct API Authorities (OpenAI -> Anthropic -> Gemini -> OpenAI)
 * Matrix B: Cloud Authorities (Bedrock -> Azure -> Vertex -> watsonx -> OCI -> Bedrock)
 * Matrix C: Local <-> Authenticated (Ollama -> OpenAI -> Ollama)
 * Matrix D: Gateway Authorities (OpenRouter -> Portkey -> Cloudflare AI Gateway -> OpenRouter)
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
    messages: [{ role: 'user', content: 'hi' }],
    apiKey,
  })) {
    events.push(e);
  }
  return events;
}

describe('Task 4 — Global Credential Authority Bleed Matrix', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let registry: PlumbModelRegistry;
  const ORIGINAL_ENV = { ...process.env };
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
  }> = [];

  // Deterministic secret canaries
  const CANARY_OPENAI = 'PLUMB_TEST_OPENAI_SECRET_A';
  const CANARY_ANTHROPIC = 'PLUMB_TEST_ANTHROPIC_SECRET_B';
  const CANARY_GEMINI = 'PLUMB_TEST_GEMINI_SECRET_C';
  const CANARY_AWS_ACCESS = 'PLUMB_TEST_AWS_ACCESS_D';
  const CANARY_AWS_SECRET = 'PLUMB_TEST_AWS_SECRET_E';
  const CANARY_AZURE = 'PLUMB_TEST_AZURE_SECRET_F';
  const CANARY_GOOGLE_TOKEN = 'PLUMB_TEST_GOOGLE_TOKEN_G';
  const CANARY_IBM = 'PLUMB_TEST_IBM_SECRET_H';
  const CANARY_OCI = 'PLUMB_TEST_OCI_SECRET_I';
  const CANARY_OPENROUTER = 'PLUMB_TEST_OPENROUTER_SECRET_J';
  const CANARY_PORTKEY = 'PLUMB_TEST_PORTKEY_SECRET_K';
  const CANARY_CF_GATEWAY = 'PLUMB_TEST_CF_GATEWAY_SECRET_L';

  beforeEach(async () => {
    const { installBunGlobal } = await import('../omp-shims/bun-runtime.js');
    installBunGlobal();
    registry = new PlumbModelRegistry();
    calls.length = 0;
    mockTextChatStream.mockReset();
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();

    process.env['AWS_ACCESS_KEY_ID'] = CANARY_AWS_ACCESS;
    process.env['AWS_SECRET_ACCESS_KEY'] = CANARY_AWS_SECRET;
    process.env['AWS_REGION'] = 'us-east-1';
    delete process.env['AWS_BEARER_TOKEN_BEDROCK'];
    process.env['AZURE_OPENAI_RESOURCE_NAME'] = 'plumb-test-resource';
    delete process.env['AZURE_OPENAI_BASE_URL'];
    delete process.env['AZURE_OPENAI_DEPLOYMENT_NAME_MAP'];
    process.env['GOOGLE_CLOUD_PROJECT'] = 'plumb-test-project';
    process.env['GOOGLE_CLOUD_LOCATION'] = 'us-central1';
    process.env['GOOGLE_CLOUD_ACCESS_TOKEN'] = CANARY_GOOGLE_TOKEN;
    process.env['WATSONX_PROJECT_ID'] = 'watsonx-proj-1';
    process.env['OCI_REGION'] = 'us-chicago-1';
    process.env['OCI_COMPARTMENT_ID'] = 'ocid1.compartment.oc1..real';
    process.env['CLOUDFLARE_ACCOUNT_ID'] = 'cfacc12345';
    process.env['CLOUDFLARE_AI_GATEWAY_ID'] = 'cfgw12345';

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
    // Preserve process.env object identity for Bun.env compatibility
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();
  });

  it('Matrix A: Direct API Authorities (OpenAI -> Anthropic -> Gemini -> OpenAI)', async () => {
    const openaiModel = registry.getModelsForProvider('openai')[0];
    const anthropicModel = registry.getModelsForProvider('anthropic-api')[0];
    const geminiModel = registry.getModelsForProvider('google')[0];

    expect(openaiModel).toBeDefined();
    expect(anthropicModel).toBeDefined();
    expect(geminiModel).toBeDefined();

    // Step 1: OpenAI
    await drain(openaiModel, CANARY_OPENAI);
    expect(calls).toHaveLength(1);
    const req1 = calls[0];
    expect(req1.url).toContain('api.openai.com');
    expect(header(req1.headers, 'authorization')).toBe(
      `Bearer ${CANARY_OPENAI}`,
    );
    expect(header(req1.headers, 'x-api-key')).toBeUndefined();
    expect(header(req1.headers, 'x-goog-api-key')).toBeUndefined();
    expect(header(req1.headers, 'api-key')).toBeUndefined();
    expect(req1.url).not.toContain(CANARY_ANTHROPIC);
    expect(req1.url).not.toContain(CANARY_GEMINI);

    // Step 2: Anthropic
    await drain(anthropicModel, CANARY_ANTHROPIC);
    expect(calls).toHaveLength(2);
    const req2 = calls[1];
    expect(req2.url).toContain('api.anthropic.com');
    expect(header(req2.headers, 'x-api-key')).toBe(CANARY_ANTHROPIC);
    expect(header(req2.headers, 'authorization')).toBeUndefined();
    expect(header(req2.headers, 'x-goog-api-key')).toBeUndefined();
    expect(header(req2.headers, 'api-key')).toBeUndefined();
    expect(JSON.stringify(req2.headers)).not.toContain(CANARY_OPENAI);
    expect(JSON.stringify(req2.headers)).not.toContain(CANARY_GEMINI);

    // Step 3: Gemini
    await drain(geminiModel, CANARY_GEMINI);
    expect(calls).toHaveLength(3);
    const req3 = calls[2];
    expect(req3.url).toContain('googleapis.com');
    const geminiHeaderKey = header(req3.headers, 'x-goog-api-key');
    const geminiUrlKey = req3.url.includes(`key=${CANARY_GEMINI}`);
    expect(geminiHeaderKey === CANARY_GEMINI || geminiUrlKey).toBe(true);
    expect(header(req3.headers, 'authorization')).toBeUndefined();
    expect(header(req3.headers, 'x-api-key')).toBeUndefined();
    expect(header(req3.headers, 'api-key')).toBeUndefined();
    expect(JSON.stringify(req3.headers)).not.toContain(CANARY_OPENAI);
    expect(JSON.stringify(req3.headers)).not.toContain(CANARY_ANTHROPIC);

    // Step 4: OpenAI return
    await drain(openaiModel, CANARY_OPENAI);
    expect(calls).toHaveLength(4);
    const req4 = calls[3];
    expect(req4.url).toContain('api.openai.com');
    expect(header(req4.headers, 'authorization')).toBe(
      `Bearer ${CANARY_OPENAI}`,
    );
    expect(header(req4.headers, 'x-api-key')).toBeUndefined();
    expect(header(req4.headers, 'x-goog-api-key')).toBeUndefined();
    expect(JSON.stringify(req4.headers)).not.toContain(CANARY_ANTHROPIC);
    expect(JSON.stringify(req4.headers)).not.toContain(CANARY_GEMINI);
  });

  it('Matrix B: Cloud Authorities (Bedrock -> Azure -> Vertex -> watsonx -> OCI -> Bedrock)', async () => {
    const [bedrockModel] = getCatalogModels('amazon-bedrock');
    const [azureModel] = getCatalogModels('azure');
    const vertexModels = getCatalogModels('google-vertex');
    const vertexModel = vertexModels.find(
      (m) => m.api === 'anthropic-messages',
    )!;
    const [watsonxModel] = getCatalogModels('watsonx');
    const [ociModel] = getCatalogModels('oci-genai');

    // 1. Bedrock (AWS SigV4 authority only)
    await drain(bedrockModel, '<authenticated>');
    expect(calls).toHaveLength(1);
    const bedrockCall1 = calls[0];
    expect(bedrockCall1.url).toContain(
      'bedrock-runtime.us-east-1.amazonaws.com',
    );
    expect(header(bedrockCall1.headers, 'authorization')).toMatch(
      /^AWS4-HMAC-SHA256 /,
    );
    expect(header(bedrockCall1.headers, 'api-key')).toBeUndefined();
    expect(header(bedrockCall1.headers, 'x-api-key')).toBeUndefined();
    expect(header(bedrockCall1.headers, 'authorization')).not.toContain(
      'Bearer',
    );

    // 2. Azure (Azure API-key authority only)
    mockTextChatStream.mockClear();
    await drain(azureModel, CANARY_AZURE);
    expect(calls).toHaveLength(2);
    const azureCall = calls[1];
    expect(azureCall.url).toContain('plumb-test-resource.openai.azure.com');
    expect(header(azureCall.headers, 'api-key')).toBe(CANARY_AZURE);
    expect(header(azureCall.headers, 'authorization')).toBeUndefined();

    // 3. Vertex (Google OAuth/ADC authority only)
    await drain(vertexModel, '<authenticated>');
    expect(calls).toHaveLength(3);
    const vertexCall = calls[2];
    expect(vertexCall.url).toContain('us-central1-aiplatform.googleapis.com');
    expect(header(vertexCall.headers, 'authorization')).toBe(
      `Bearer ${CANARY_GOOGLE_TOKEN}`,
    );
    expect(header(vertexCall.headers, 'api-key')).toBeUndefined();
    expect(header(vertexCall.headers, 'x-api-key')).toBeUndefined();

    // 4. watsonx (IBM authority only, SDK boundary)
    mockTextChatStream.mockResolvedValue(
      (async function* () {
        yield { data: { choices: [{ delta: { content: 'hi' } }] } };
      })(),
    );
    await drain(watsonxModel, CANARY_IBM);
    expect(calls).toHaveLength(3); // Watsonx uses SDK stream directly, fetch count unchanged
    expect(mockTextChatStream).toHaveBeenCalledTimes(1);

    // 5. OCI (OCI authority only)
    await drain(ociModel, CANARY_OCI);
    expect(calls).toHaveLength(4);
    const ociCall = calls[3];
    expect(ociCall.url).toContain('oraclecloud.com');
    expect(JSON.stringify(ociCall.headers)).not.toContain(CANARY_AZURE);
    expect(JSON.stringify(ociCall.headers)).not.toContain(CANARY_GOOGLE_TOKEN);

    // 6. Bedrock return
    await drain(bedrockModel, '<authenticated>');
    expect(calls).toHaveLength(5);
    const bedrockCall2 = calls[4];
    expect(bedrockCall2.url).toContain(
      'bedrock-runtime.us-east-1.amazonaws.com',
    );
    expect(header(bedrockCall2.headers, 'authorization')).toMatch(
      /^AWS4-HMAC-SHA256 /,
    );
    expect(header(bedrockCall2.headers, 'api-key')).toBeUndefined();
    expect(header(bedrockCall2.headers, 'x-api-key')).toBeUndefined();
    expect(header(bedrockCall2.headers, 'authorization')).not.toContain(
      'Bearer',
    );
  });

  it('Matrix C: Local <-> Authenticated (Ollama -> OpenAI -> Ollama)', async () => {
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

    expect(openaiModel).toBeDefined();

    // 1. Ollama before auth provider
    await drain(ollamaModel, '');
    expect(calls).toHaveLength(1);
    const localCall1 = calls[0];
    expect(header(localCall1.headers, 'authorization')).toBeUndefined();

    // 2. Authenticated API provider
    await drain(openaiModel, CANARY_OPENAI);
    expect(calls).toHaveLength(2);
    const authCall = calls[1];
    expect(header(authCall.headers, 'authorization')).toBe(
      `Bearer ${CANARY_OPENAI}`,
    );

    // 3. Ollama after auth provider -- AUTH_HEADER_BLEED must be ZERO
    await drain(ollamaModel, '');
    expect(calls).toHaveLength(3);
    const localCall2 = calls[2];
    expect(header(localCall2.headers, 'authorization')).toBeUndefined();
    expect(JSON.stringify(localCall2.headers)).not.toContain(CANARY_OPENAI);
  });

  it('Matrix D: Gateway Authorities (OpenRouter -> Portkey -> Cloudflare AI Gateway -> OpenRouter)', async () => {
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
      headers: { 'x-portkey-api-key': CANARY_PORTKEY },
      contextWindow: 128000,
      maxTokens: 4096,
      input: 'text',
    };
    const cfGatewayModel: PlumbModel = {
      id: '@cf/meta/llama-3-8b-instruct',
      provider: 'cloudflare-ai-gateway',
      api: 'openai-completions',
      baseUrl:
        'https://gateway.ai.cloudflare.com/v1/cfacc12345/cfgw12345/openai',
      contextWindow: 8192,
      maxTokens: 4096,
      input: 'text',
    };

    // 1. OpenRouter
    await drain(openrouterModel, CANARY_OPENROUTER);
    expect(calls).toHaveLength(1);
    const openrouterReq1 = calls[0];
    expect(openrouterReq1.url).toContain('openrouter.ai');
    expect(header(openrouterReq1.headers, 'authorization')).toBe(
      `Bearer ${CANARY_OPENROUTER}`,
    );
    expect(header(openrouterReq1.headers, 'x-portkey-api-key')).toBeUndefined();
    expect(header(openrouterReq1.headers, 'cf-access-token')).toBeUndefined();

    // 2. Portkey
    await drain(portkeyModel, CANARY_PORTKEY);
    expect(calls).toHaveLength(2);
    const portkeyReq = calls[1];
    expect(portkeyReq.url).toContain('portkey');
    expect(header(portkeyReq.headers, 'x-portkey-api-key')).toBe(
      CANARY_PORTKEY,
    );
    expect(JSON.stringify(portkeyReq.headers)).not.toContain(CANARY_OPENROUTER);

    // 3. Cloudflare AI Gateway
    await drain(cfGatewayModel, CANARY_CF_GATEWAY);
    expect(calls).toHaveLength(3);
    const cfReq = calls[2];
    expect(cfReq.url).toContain('gateway.ai.cloudflare.com');
    expect(JSON.stringify(cfReq.headers)).not.toContain(CANARY_OPENROUTER);
    expect(JSON.stringify(cfReq.headers)).not.toContain(CANARY_PORTKEY);

    // 4. OpenRouter return
    await drain(openrouterModel, CANARY_OPENROUTER);
    expect(calls).toHaveLength(4);
    const openrouterReq2 = calls[3];
    expect(openrouterReq2.url).toContain('openrouter.ai');
    expect(header(openrouterReq2.headers, 'authorization')).toBe(
      `Bearer ${CANARY_OPENROUTER}`,
    );
    expect(header(openrouterReq2.headers, 'x-portkey-api-key')).toBeUndefined();
    expect(JSON.stringify(openrouterReq2.headers)).not.toContain(
      CANARY_PORTKEY,
    );
    expect(JSON.stringify(openrouterReq2.headers)).not.toContain(
      CANARY_CF_GATEWAY,
    );
  });
});

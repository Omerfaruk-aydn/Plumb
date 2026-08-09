/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 11 Dialect/Transport Coverage Matrix:
 * Exercises every wire dialect / transport in PlumbKnownApi:
 * 1. openai-completions
 * 2. openai-responses
 * 3. anthropic-messages
 * 4. google-generative-ai
 * 5. google-gemini-cli
 * 6. google-vertex
 * 7. ollama-chat
 * 8. openrouter
 * 9. claude-agent-sdk
 * 10. watsonx-chat
 * 11. oci-openai-responses
 * 12. bedrock-converse-stream
 * 13. azure-openai-responses
 * 14. openai-codex-responses
 * 15. cursor-agent
 * 16. devin-agent
 * 17. gitlab-duo-agent
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { plumbModelStream } from './streaming.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';
import { __resetVertexTokenCache } from '../omp-ai/providers/google-auth.js';
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

function encodeEventStreamMessage(
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): Uint8Array {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const headerParts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const nameBytes = new TextEncoder().encode(name);
    const valueBytes = new TextEncoder().encode(value);
    const buf = new Uint8Array(
      1 + nameBytes.length + 1 + 2 + valueBytes.length,
    );
    let o = 0;
    buf[o++] = nameBytes.length;
    buf.set(nameBytes, o);
    o += nameBytes.length;
    buf[o++] = 7;
    buf[o++] = (valueBytes.length >> 8) & 0xff;
    buf[o++] = valueBytes.length & 0xff;
    buf.set(valueBytes, o);
    headerParts.push(buf);
  }
  const headerBytes = new Uint8Array(
    headerParts.reduce((n, p) => n + p.length, 0),
  );
  let ho = 0;
  for (const p of headerParts) {
    headerBytes.set(p, ho);
    ho += p.length;
  }

  const totalLength = 4 + 4 + 4 + headerBytes.length + payloadBytes.length + 4;
  const out = new Uint8Array(totalLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headerBytes.length, false);
  const crc32 = (bytes: Uint8Array): number =>
    (
      globalThis as unknown as {
        Bun: { hash: { crc32: (b: Uint8Array) => number } };
      }
    ).Bun.hash.crc32(bytes) >>> 0;
  view.setUint32(8, crc32(out.subarray(0, 8)), false);
  out.set(headerBytes, 12);
  out.set(payloadBytes, 12 + headerBytes.length);
  view.setUint32(
    12 + headerBytes.length + payloadBytes.length,
    crc32(out.subarray(0, totalLength - 4)),
    false,
  );
  return out;
}

async function drain(
  model: PlumbModel,
  apiKey?: string,
): Promise<PlumbStreamEvent[]> {
  const events: PlumbStreamEvent[] = [];
  for await (const e of plumbModelStream({
    model,
    messages: [{ role: 'user', content: 'dialect test' }],
    apiKey,
  })) {
    events.push(e);
  }
  return events;
}

describe('Task 11 — Dialect/Transport Coverage Matrix', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const ORIGINAL_ENV = { ...process.env };
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];

  beforeEach(async () => {
    const { installBunGlobal } = await import('../omp-shims/bun-runtime.js');
    installBunGlobal();
    calls.length = 0;
    mockQuery.mockReset();
    mockTextChatStream.mockReset();
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();

    process.env['AWS_ACCESS_KEY_ID'] = 'AKIA_DIALECT_11';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'SECRET_DIALECT_11';
    process.env['AWS_REGION'] = 'us-east-1';

    process.env['AZURE_OPENAI_RESOURCE_NAME'] = 'azure-res-11';
    process.env['GOOGLE_CLOUD_PROJECT'] = 'vertex-proj-11';
    process.env['GOOGLE_CLOUD_LOCATION'] = 'us-central1';
    process.env['GOOGLE_CLOUD_ACCESS_TOKEN'] = 'vertex-tok-11';
    process.env['WATSONX_PROJECT_ID'] = 'watsonx-p-11';
    process.env['OCI_REGION'] = 'us-ashburn-1';
    process.env['OCI_COMPARTMENT_ID'] = 'ocid1.compartment.oc1..11';

    registerPlumbCredentialStoreFactory(() => ({
      getCredentials: async (p: string) => [
        {
          id: 'test-oauth-11',
          provider: p,
          credential: {
            type: 'oauth' as const,
            provider: p,
            access: 'oauth-token-11',
            refresh: 'oauth-refresh-11',
            expires: Date.now() + 3600000,
            projectId: 'project-11',
          },
          addedAt: Date.now(),
          lastUsedAt: Date.now(),
        },
      ],
      getApiKey: async () => 'key-11',
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
        credentialRefs: ['test-oauth-11'],
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

      if (urlStr.includes('bedrock-runtime')) {
        const frame = encodeEventStreamMessage(
          { ':event-type': 'messageStop', ':message-type': 'event' },
          { stopReason: 'end_turn' },
        );
        return new Response(frame, {
          status: 200,
          headers: { 'content-type': 'application/vnd.amazon.eventstream' },
        });
      }

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

  it('1. openai-completions dialect', async () => {
    const [model] = getCatalogModels('openai');
    const events = await drain(model, 'key-11');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('2. openai-responses dialect', async () => {
    const model: PlumbModel = {
      id: 'gpt-4o-realtime',
      provider: 'openai',
      api: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      contextWindow: 128000,
      maxTokens: 4096,
      input: 'text',
    };
    const events = await drain(model, 'key-11');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('3. anthropic-messages dialect', async () => {
    const [model] = getCatalogModels('anthropic-api');
    const events = await drain(model, 'key-11');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('4. google-generative-ai dialect', async () => {
    const [model] = getCatalogModels('google');
    const events = await drain(model, 'key-11');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('5. google-gemini-cli (antigravity) dialect', async () => {
    const model: PlumbModel = {
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
  });

  it('6. google-vertex dialect', async () => {
    const vertexModels = getCatalogModels('google-vertex');
    const vertexModel = vertexModels.find(
      (m) => m.api === 'anthropic-messages',
    )!;
    const events = await drain(vertexModel, '<authenticated>');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('7. ollama-chat dialect', async () => {
    const model: PlumbModel = {
      id: 'llama3:8b',
      provider: 'ollama',
      api: 'ollama-chat',
      baseUrl: 'http://127.0.0.1:11434/v1',
      contextWindow: 8192,
      maxTokens: 4096,
      input: 'text',
    };
    const events = await drain(model, '');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('8. openrouter dialect', async () => {
    const model: PlumbModel = {
      id: 'openrouter/auto',
      provider: 'openrouter',
      api: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      contextWindow: 128000,
      maxTokens: 4096,
      input: 'text',
    };
    const events = await drain(model, 'key-11');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('9. claude-agent-sdk dialect', async () => {
    const [model] = getCatalogModels('claude-subscription');
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: 'text', text: 'sdk ok' };
      })(),
    );
    const events = await drain(model, '<authenticated>');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('10. watsonx-chat dialect', async () => {
    const [model] = getCatalogModels('watsonx');
    mockTextChatStream.mockResolvedValue(
      (async function* () {
        yield { data: { choices: [{ delta: { content: 'watsonx ok' } }] } };
      })(),
    );
    const events = await drain(model, 'key-11');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('11. oci-openai-responses dialect', async () => {
    const [model] = getCatalogModels('oci-genai');
    const events = await drain(model, 'key-11');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('12. bedrock-converse-stream dialect', async () => {
    const [model] = getCatalogModels('amazon-bedrock');
    const events = await drain(model, '<authenticated>');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('13. azure-openai-responses dialect', async () => {
    const [model] = getCatalogModels('azure');
    const events = await drain(model, 'key-11');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('14. openai-codex-responses dialect', async () => {
    const model: PlumbModel = {
      id: 'code-davinci-002',
      provider: 'openai-codex',
      api: 'openai-codex-responses',
      baseUrl: 'https://api.openai.com/v1',
      contextWindow: 8000,
      maxTokens: 2048,
      input: 'text',
    };
    const events = await drain(model, 'key-11');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('15. cursor-agent dialect', async () => {
    const model: PlumbModel = {
      id: 'cursor-fast',
      provider: 'cursor',
      api: 'cursor-agent',
      baseUrl: 'https://api.cursor.com/v1',
      contextWindow: 32000,
      maxTokens: 4096,
      input: 'text',
    };
    const events = await drain(model, 'key-11');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('16. devin-agent dialect', async () => {
    const model: PlumbModel = {
      id: 'devin-v1',
      provider: 'devin',
      api: 'devin-agent',
      baseUrl: 'https://api.devin.ai/v1',
      contextWindow: 128000,
      maxTokens: 4096,
      input: 'text',
    };
    const events = await drain(model, 'key-11');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('17. gitlab-duo-agent dialect', async () => {
    const model: PlumbModel = {
      id: 'gitlab-duo-chat',
      provider: 'gitlab-duo',
      api: 'gitlab-duo-agent',
      baseUrl: 'https://gitlab.com/api/v4',
      contextWindow: 32000,
      maxTokens: 4096,
      input: 'text',
    };
    const events = await drain(model, 'key-11');
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });
});

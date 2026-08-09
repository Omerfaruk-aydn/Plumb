/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production-shaped integration test for the full local-provider chain:
 *
 *   server /api/tags or /v1/models
 *   -> discovery adapter
 *   -> PlumbModelRegistry.discoverLocalModels
 *   -> registry.findModel (what PlumbContentGenerator#doStream calls)
 *   -> plumbModelStream (the real production transport)
 *   -> correct host / correct wire model id / no fabricated auth header
 *
 * Covers all five local providers (Ollama, LM Studio, llama.cpp, vLLM,
 * SGLang) and proves zero endpoint/model/auth-header bleed across a
 * representative switch sequence between them.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { PlumbModelRegistry } from './model-registry.js';
import { plumbModelStream } from '../transports/streaming.js';
import type { PlumbStreamEvent } from '../types.js';

interface LocalProviderFixture {
  providerId: string;
  baseUrl: string;
  discoveryBaseUrl?: string;
  modelId: string;
  /** Response shape for this provider's discovery endpoint. */
  discoveryPath: string;
  discoveryBody: unknown;
  expectedApi: string;
}

const FIXTURES: LocalProviderFixture[] = [
  {
    providerId: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    discoveryBaseUrl: 'http://127.0.0.1:11434',
    modelId: 'llama3:8b',
    discoveryPath: '/api/tags',
    discoveryBody: { models: [{ name: 'llama3:8b' }] },
    expectedApi: 'ollama-chat',
  },
  {
    providerId: 'lm-studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    modelId: 'lmstudio-community/llama-3-8b',
    discoveryPath: '/models',
    discoveryBody: { data: [{ id: 'lmstudio-community/llama-3-8b' }] },
    expectedApi: 'openai-completions',
  },
  {
    providerId: 'llama-cpp',
    baseUrl: 'http://127.0.0.1:8080/v1',
    modelId: 'gguf-model',
    discoveryPath: '/models',
    discoveryBody: { data: [{ id: 'gguf-model' }] },
    expectedApi: 'openai-completions',
  },
  {
    providerId: 'vllm',
    baseUrl: 'http://127.0.0.1:8000/v1',
    modelId: 'gpt-oss-20b',
    discoveryPath: '/models',
    discoveryBody: { data: [{ id: 'gpt-oss-20b' }] },
    expectedApi: 'openai-completions',
  },
  {
    providerId: 'sglang',
    baseUrl: 'http://127.0.0.1:30000/v1',
    modelId: 'qwen2.5-7b-instruct',
    discoveryPath: '/models',
    discoveryBody: { data: [{ id: 'qwen2.5-7b-instruct' }] },
    expectedApi: 'openai-completions',
  },
];

function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl}/chat/completions`;
}

/** A minimal SSE response any of the OpenAI-compatible/Ollama transports can consume. */
function sseResponse(): Response {
  const body =
    'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' + 'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function findFixtureForUrl(url: string): LocalProviderFixture | undefined {
  return FIXTURES.find((f) => url.startsWith(f.discoveryBaseUrl ?? f.baseUrl));
}

/**
 * A fetch stub that answers like all five real local servers would be
 * running simultaneously: it routes purely on the request's own host/path,
 * never on test-harness state. discoverLocalModels() queries every local
 * provider's discovery endpoint on every call (by design -- it's a single
 * sweep across LOCAL_PROVIDERS), so the stub must be able to answer any of
 * them at any time, exactly like real independent local servers would.
 */
function createMultiServerFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const fixture = findFixtureForUrl(url);
    if (!fixture) {
      // A local provider whose server isn't "running" in this scenario.
      throw new Error('ECONNREFUSED');
    }
    if (url.endsWith(fixture.discoveryPath)) {
      return new Response(JSON.stringify(fixture.discoveryBody), {
        status: 200,
      });
    }
    void init;
    return sseResponse();
  });
}

describe('Local provider chain: discovery -> registry -> selection -> production request', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const fixture of FIXTURES) {
    it(`${fixture.providerId}: a discovered model routes to ${fixture.baseUrl} with its own wire id and no fabricated auth header`, async () => {
      const requests: Array<{ url: string; init?: RequestInit }> = [];
      const baseFetch = createMultiServerFetch();
      const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return baseFetch(url, init);
      });
      vi.stubGlobal('fetch', mockFetch);

      const registry = new PlumbModelRegistry();
      await registry.discoverLocalModels();
      const discoveryCallCount = requests.length;

      const model = registry.findModel(fixture.providerId, fixture.modelId);
      expect(
        model,
        `${fixture.providerId} model was not discovered`,
      ).toBeDefined();
      expect(model!.api).toBe(fixture.expectedApi);
      expect(model!.baseUrl).toBe(fixture.baseUrl);
      expect(model!.source).toBe('SERVER_DYNAMIC');

      // This mirrors exactly what packages/core/src/core/plumbContentGenerator.ts
      // does with the registry-resolved model before calling plumbModelStream.
      const events: PlumbStreamEvent[] = [];
      for await (const event of plumbModelStream({
        model: model!,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: '',
      })) {
        events.push(event);
      }

      expect(events.some((e) => e.type === 'error')).toBe(false);

      // Everything after the discovery sweep is the actual chat call.
      const chatCall = requests[discoveryCallCount];
      expect(
        chatCall,
        `${fixture.providerId} never issued a chat request`,
      ).toBeDefined();
      expect(chatCall!.url.startsWith(fixture.baseUrl)).toBe(true);
      expect(chatCall!.url).toBe(chatCompletionsUrl(fixture.baseUrl));
      const bodyStr = String(chatCall!.init?.body ?? '');
      expect(bodyStr).toContain(fixture.modelId);
      const headers = chatCall!.init?.headers as
        | Record<string, string>
        | undefined;
      expect(headers?.['Authorization']).toBeUndefined();
    });
  }

  it("endpoint/provider/auth-header bleed: switching between all five local providers in sequence never leaks another provider's host, model id, or auth header", async () => {
    type RecordedRequest = {
      intendedProvider: string;
      url: string;
      init?: RequestInit;
    };
    const requests: RecordedRequest[] = [];
    let intendedProvider = FIXTURES[0].providerId;

    const baseFetch = createMultiServerFetch();
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ intendedProvider, url, init });
      return baseFetch(url, init);
    });
    vi.stubGlobal('fetch', mockFetch);

    const registry = new PlumbModelRegistry();

    // Forward sweep A -> B -> C -> D -> E, then a representative reverse
    // transition E -> A, exactly as the bleed matrix requires.
    const sequence = [...FIXTURES, FIXTURES[0]];
    const chatCallUrlsByStep: string[] = [];
    for (const fixture of sequence) {
      intendedProvider = fixture.providerId;
      await registry.discoverLocalModels();
      const model = registry.findModel(fixture.providerId, fixture.modelId);
      expect(model).toBeDefined();
      const before = requests.length;
      for await (const _event of plumbModelStream({
        model: model!,
        messages: [
          { role: 'user', content: `switch to ${fixture.providerId}` },
        ],
        apiKey: '',
      })) {
        // drain
      }
      // The chat call is whatever request landed after the discovery sweep
      // for this step -- must hit exactly this fixture's own host.
      const chatCall = requests[requests.length - 1];
      expect(requests.length).toBeGreaterThan(before);
      expect(chatCall.url.startsWith(fixture.baseUrl)).toBe(true);
      expect(chatCall.url).toBe(chatCompletionsUrl(fixture.baseUrl));
      chatCallUrlsByStep.push(chatCall.url);

      const otherHosts = FIXTURES.filter(
        (f) => f.providerId !== fixture.providerId,
      );
      for (const other of otherHosts) {
        expect(chatCall.url.startsWith(other.baseUrl)).toBe(false);
      }
      const headers = chatCall.init?.headers as
        | Record<string, string>
        | undefined;
      expect(headers?.['Authorization']).toBeUndefined();
      const bodyStr = String(chatCall.init?.body ?? '');
      expect(bodyStr).toContain(fixture.modelId);
    }

    // The reverse transition (E -> A, last two steps) must have produced two
    // distinct hosts, not a stale endpoint carried over from the prior step.
    expect(chatCallUrlsByStep.at(-1)).toBe(chatCallUrlsByStep[0]);
    expect(chatCallUrlsByStep.at(-2)).not.toBe(chatCallUrlsByStep.at(-1));
  });

  it('optional local auth stays provider-scoped across authenticated Ollama -> keyless LM Studio -> authenticated Ollama', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const baseFetch = createMultiServerFetch();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return baseFetch(url, init);
      }),
    );

    const registry = new PlumbModelRegistry();
    await registry.discoverLocalModels();
    const ollama = registry.findModel('ollama', 'llama3:8b')!;
    const lmStudio = registry.findModel(
      'lm-studio',
      'lmstudio-community/llama-3-8b',
    )!;

    for (const [model, apiKey] of [
      [ollama, 'ollama-secret-canary'],
      [lmStudio, ''],
      [ollama, 'ollama-secret-canary'],
    ] as const) {
      for await (const _event of plumbModelStream({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey,
      })) {
        // drain
      }
    }

    const chats = requests.filter((request) =>
      request.url.endsWith('/chat/completions'),
    );
    expect(chats).toHaveLength(3);
    const auth = chats.map(
      (request) =>
        (request.init?.headers as Record<string, string> | undefined)?.[
          'Authorization'
        ],
    );
    expect(auth).toEqual([
      'Bearer ollama-secret-canary',
      undefined,
      'Bearer ollama-secret-canary',
    ]);
  });
});

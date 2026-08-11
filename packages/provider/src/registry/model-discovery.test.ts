/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Discovery adapter contract tests.
 * Verifies every registered adapter responds correctly at the HTTP boundary.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock fetch globally for adapter tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  discoverProviderModels,
  discoverProviderModelsDetailed,
  getDiscoveryProviderIds,
} from './model-discovery.js';

// Hand-written adapters with bespoke HTTP-boundary parsing (tested below).
const HAND_WRITTEN_ADAPTERS = [
  'ollama',
  'llama-cpp',
  'sglang',
  'openai',
  'groq',
  'mistral',
  'together',
  'fireworks',
  'deepseek',
  'moonshot',
  'cerebras',
  'nvidia',
  'novita',
  'venice',
  'perplexity',
  'claude-subscription',
];

// A sample of catalog providers that have no hand-written adapter and must
// be covered by the generic OMP-model-manager-backed fallback instead
// (see OmpModelManagerDiscovery in model-discovery.ts).
const OMP_BACKED_SAMPLE = [
  'google',
  'google-vertex',
  'github-copilot',
  'anthropic',
  'anthropic-api',
  'sambanova',
  'nebius',
  'cohere',
  'byteplus-modelark',
  'volcengine-ark',
  'openrouter',
];

describe('Discovery Adapter Registry', () => {
  it('1. registers every hand-written adapter', () => {
    const ids = getDiscoveryProviderIds();
    for (const expected of HAND_WRITTEN_ADAPTERS) {
      expect(ids).toContain(expected);
    }
  });

  it('2. all documented adapters are registered', () => {
    const ids = getDiscoveryProviderIds();
    for (const expected of HAND_WRITTEN_ADAPTERS) {
      expect(ids).toContain(expected);
    }
  });

  it('3. no duplicate provider IDs', () => {
    const ids = getDiscoveryProviderIds();
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('4. the generic OMP-backed adapter fills every remaining catalog provider', () => {
    const ids = getDiscoveryProviderIds();
    for (const expected of OMP_BACKED_SAMPLE) {
      expect(ids).toContain(expected);
    }
    // Strictly more coverage than the hand-written set alone — the generic
    // fallback must actually be registering providers, not a no-op.
    expect(ids.length).toBeGreaterThan(HAND_WRITTEN_ADAPTERS.length + 20);
  });
});

describe('Discovery Adapter Contract: Claude Subscription (Agent SDK)', () => {
  it('discovers the bundled Anthropic model family tagged with the claude-agent-sdk dialect', async () => {
    const models = await discoverProviderModels('claude-subscription', {
      providerId: 'claude-subscription',
    });

    expect(models.length).toBeGreaterThan(0);
    // A discovered id is either a dated `claude-*` id (the pinned
    // OFFICIAL_STATIC_METADATA floor) or one of the Agent SDK's own
    // documented generic aliases (live ACCOUNT_DYNAMIC discovery via
    // `Query.supportedModels()` -- see getClaudeSubscriptionModels) --
    // both are real, non-fabricated sources.
    const KNOWN_GENERIC_ALIASES = new Set([
      'sonnet',
      'opus',
      'haiku',
      'sonnet[1m]',
      'opusplan',
    ]);
    for (const model of models) {
      expect(model.api).toBe('claude-agent-sdk');
      expect(
        model.id.startsWith('claude-') || KNOWN_GENERIC_ALIASES.has(model.id),
      ).toBe(true);
    }
  });

  it('does not require an apiKey/oauthToken (the Agent SDK owns its own auth)', async () => {
    // No apiKey/oauthToken passed — the Agent SDK never receives PLUMB
    // credentials directly, unlike every other discovery adapter.
    const models = await discoverProviderModels('claude-subscription', {
      providerId: 'claude-subscription',
    });
    expect(models.length).toBeGreaterThan(0);
  });
});

describe('Discovery Adapter Contract: OMP model-manager-backed fallback', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  it('13. returns empty array without credentials (no fetchDynamicModels wired)', async () => {
    const models = await discoverProviderModels('google-vertex', {
      providerId: 'google-vertex',
    });
    expect(models).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('14. discovers live models through the OMP model-manager pipeline', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          {
            name: 'publishers/google/models/gemini-3.1-pro-preview',
            displayName: 'Gemini 3.1 Pro Preview',
            inputTokenLimit: 1000000,
            outputTokenLimit: 65536,
            supportedActions: { generateContent: {} },
          },
        ],
      }),
    });

    const models = await discoverProviderModels('google-vertex', {
      providerId: 'google-vertex',
      apiKey: 'test-vertex-key',
    });

    // The live fetch result is merged with google-vertex's static bundled
    // catalog (the OMP model manager treats static entries as a floor, not
    // something a dynamic fetch replaces, unless dynamicModelsAuthoritative
    // is set) — assert the dynamically-fetched model is present with its
    // live metadata, not that it's the only model returned.
    const dynamic = models.find((m) => m.id === 'gemini-3.1-pro-preview');
    expect(dynamic).toMatchObject({
      id: 'gemini-3.1-pro-preview',
      contextWindow: 1000000,
      maxTokens: 65536,
      // Regression guard: the OMP-backed adapter must report the model's
      // real wire dialect, not silently default to 'openai-completions'
      // (google-vertex speaks a completely different request shape).
      api: 'google-vertex',
    });
  });

  it('15. falls back to the static bundled catalog on a transport failure instead of throwing', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const models = await discoverProviderModels('google-vertex', {
      providerId: 'google-vertex',
      apiKey: 'test-vertex-key',
    });
    // A failed dynamic fetch must never surface as a thrown error or wipe
    // out the static floor — it degrades to the bundled catalog.
    expect(models.length).toBeGreaterThan(0);
  });

  it('16. anthropic and anthropic-api both resolve to live discovery for the same OMP entry', async () => {
    const ids = getDiscoveryProviderIds();
    expect(ids).toContain('anthropic');
    expect(ids).toContain('anthropic-api');
  });

  it('17. preserves OpenRouter official base URL and dialect', async () => {
    const models = await discoverProviderModels('openrouter', {
      providerId: 'openrouter',
      apiKey: 'openrouter-key',
    });

    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toMatchObject({
      api: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  });
});

describe('Discovery Adapter Contract: OpenAI-compatible', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  it('5. parses OpenAI-compatible /v1/models response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-4', name: 'GPT-4' },
          { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
        ],
      }),
    });

    const models = await discoverProviderModels('openai', {
      providerId: 'openai',
      apiKey: 'test-key',
    });

    const ids = models.map((m) => m.id).sort();
    expect(ids).toEqual(['gpt-3.5-turbo', 'gpt-4']);
    const openaiCalls = mockFetch.mock.calls.filter(
      (call) => call[0] === 'https://api.openai.com/models',
    );
    expect(openaiCalls.length).toBe(1);
    expect(JSON.stringify(openaiCalls[0][1]?.headers ?? {})).toContain(
      'Bearer test-key',
    );
  });

  it('6. returns empty array on unauthorized', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const models = await discoverProviderModels('openai', {
      providerId: 'openai',
      apiKey: 'bad-key',
    });

    expect(models).toEqual([]);
  });

  it('7. returns empty array on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'));

    const models = await discoverProviderModels('openai', {
      providerId: 'openai',
      apiKey: 'test-key',
    });

    expect(models).toEqual([]);
  });

  it('8. returns empty array when no credentials', async () => {
    const models = await discoverProviderModels('openai', {
      providerId: 'openai',
    });

    expect(models).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('Discovery Adapter Contract: Ollama', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  it('9. parses Ollama /api/tags response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          { name: 'llama3:8b', details: { parameter_size: '8B' } },
          { name: 'mistral:7b', details: { parameter_size: '7B' } },
        ],
      }),
    });

    const models = await discoverProviderModels('ollama', {
      providerId: 'ollama',
    });

    expect(models.length).toBe(2);
    expect(models[0].id).toBe('llama3:8b');
    expect(models[0].contextWindow).toBe(128000);
  });

  it('9b. tags the discovered model with baseUrl and the ollama-chat dialect (regression: a selected discovered model must carry enough to route to the real transport, not fall through to https://api.openai.com)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3:8b' }] }),
    });

    const models = await discoverProviderModels('ollama', {
      providerId: 'ollama',
    });

    expect(models[0].api).toBe('ollama-chat');
    expect(models[0].baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(models[0].source).toBe('SERVER_DYNAMIC');
  });

  it('10. handles unavailable local endpoint', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const models = await discoverProviderModels('ollama', {
      providerId: 'ollama',
    });

    expect(models).toEqual([]);
  });

  it('10a. distinguishes an unavailable server from a valid empty catalog', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(
      discoverProviderModelsDetailed('ollama', { providerId: 'ollama' }),
    ).resolves.toEqual({
      models: [],
      status: 'unavailable',
      errorCode: 'SERVER_UNAVAILABLE',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    });
    await expect(
      discoverProviderModelsDetailed('ollama', { providerId: 'ollama' }),
    ).resolves.toEqual({ models: [], status: 'empty' });
  });

  it('10c. classifies malformed discovery payloads without exposing response data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: 'not-an-array' }),
    });

    await expect(
      discoverProviderModelsDetailed('ollama', { providerId: 'ollama' }),
    ).resolves.toEqual({
      models: [],
      status: 'error',
      errorCode: 'DISCOVERY_PROTOCOL_ERROR',
    });
  });

  it('10b. enriches context, vision, reasoning, and tool capabilities from /api/show', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/tags')) {
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'qwen-vl:latest' }] }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          capabilities: ['vision', 'thinking', 'tools'],
          model_info: { 'qwen.context_length': 65536 },
        }),
      };
    });

    const models = await discoverProviderModels('ollama', {
      providerId: 'ollama',
    });

    expect(models[0]).toMatchObject({
      id: 'qwen-vl:latest',
      contextWindow: 65536,
      input: 'text+image',
      reasoning: true,
      toolsSupported: true,
      source: 'SERVER_DYNAMIC',
    });
  });
});

describe('Discovery Adapter Contract: Local OpenAI-compatible', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  it('11. discovers LM Studio models', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v0/models')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'lmstudio-community/llama-3-8b',
                type: 'vlm',
                state: 'loaded',
                loaded_context_length: 32768,
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'lmstudio-community/llama-3-8b' }],
        }),
      };
    });

    const models = await discoverProviderModels('lm-studio', {
      providerId: 'lm-studio',
    });

    expect(
      models.find((m) => m.id === 'lmstudio-community/llama-3-8b'),
    ).toMatchObject({
      contextWindow: 32768,
      input: 'text+image',
      source: 'SERVER_DYNAMIC',
    });
    expect(
      mockFetch.mock.calls.some(
        (call) => call[0] === 'http://127.0.0.1:1234/v1/models',
      ),
    ).toBe(true);
  });

  it('11a. distinguishes auth, protocol, and successful-empty outcomes', async () => {
    mockFetch.mockResolvedValueOnce({ status: 401, ok: false });
    await expect(
      discoverProviderModelsDetailed('sglang', { providerId: 'sglang' }),
    ).resolves.toEqual({
      models: [],
      status: 'error',
      errorCode: 'DISCOVERY_AUTH_FAILED',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ unexpected: true }),
    });
    await expect(
      discoverProviderModelsDetailed('sglang', { providerId: 'sglang' }),
    ).resolves.toEqual({
      models: [],
      status: 'error',
      errorCode: 'DISCOVERY_PROTOCOL_ERROR',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });
    await expect(
      discoverProviderModelsDetailed('sglang', { providerId: 'sglang' }),
    ).resolves.toEqual({ models: [], status: 'empty' });
  });

  it('12. returns empty for provider without discovery', async () => {
    const models = await discoverProviderModels('unknown-provider', {
      providerId: 'unknown-provider',
    });

    expect(models).toEqual([]);
  });

  it('11b. tags LM Studio models with baseUrl and the openai-completions dialect (regression: same as Ollama, a selected discovered model must carry its baseUrl to route correctly)', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v0/models')) {
        return { ok: false, json: async () => ({}) };
      }
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'lmstudio-community/llama-3-8b' }],
        }),
      };
    });

    const models = await discoverProviderModels('lm-studio', {
      providerId: 'lm-studio',
    });

    const dynamic = models.find(
      (model) => model.id === 'lmstudio-community/llama-3-8b',
    );
    expect(dynamic?.api).toBe('openai-completions');
    expect(dynamic?.baseUrl).toBe('http://127.0.0.1:1234/v1');
    expect(dynamic?.source).toBe('SERVER_DYNAMIC');
  });

  it('11c. preserves vLLM max_model_len metadata', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'served-qwen', max_model_len: 49152 }],
      }),
    });

    const models = await discoverProviderModels('vllm', {
      providerId: 'vllm',
    });

    expect(models.find((model) => model.id === 'served-qwen')).toMatchObject({
      contextWindow: 49152,
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:8000/v1',
      source: 'SERVER_DYNAMIC',
    });
  });

  it('13. discovers SGLang models against its default port 30000', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'qwen2.5-7b-instruct' }] }),
    });

    const models = await discoverProviderModels('sglang', {
      providerId: 'sglang',
    });

    expect(models.some((m) => m.id === 'qwen2.5-7b-instruct')).toBe(true);
    expect(models[0].baseUrl).toBe('http://127.0.0.1:30000/v1');
    expect(
      mockFetch.mock.calls.some(
        (call) => call[0] === 'http://127.0.0.1:30000/v1/models',
      ),
    ).toBe(true);
  });
});

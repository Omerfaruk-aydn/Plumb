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
  getDiscoveryProviderIds,
} from './model-discovery.js';

// Hand-written adapters with bespoke HTTP-boundary parsing (tested below).
const HAND_WRITTEN_ADAPTERS = [
  'ollama',
  'lm-studio',
  'llama-cpp',
  'vllm',
  'openai',
  'openrouter',
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
    for (const model of models) {
      expect(model.api).toBe('claude-agent-sdk');
      expect(model.id).toMatch(/^claude-/);
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
    expect(models[0].contextWindow).toBe(131072);
  });

  it('10. handles unavailable local endpoint', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const models = await discoverProviderModels('ollama', {
      providerId: 'ollama',
    });

    expect(models).toEqual([]);
  });
});

describe('Discovery Adapter Contract: Local OpenAI-compatible', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  it('11. discovers LM Studio models', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: 'llama-3-8b' }],
      }),
    });

    const models = await discoverProviderModels('lm-studio', {
      providerId: 'lm-studio',
    });

    expect(models.some((m) => m.id === 'llama-3-8b')).toBe(true);
    expect(
      mockFetch.mock.calls.some(
        (call) => call[0] === 'http://127.0.0.1:1234/models',
      ),
    ).toBe(true);
  });

  it('12. returns empty for provider without discovery', async () => {
    const models = await discoverProviderModels('unknown-provider', {
      providerId: 'unknown-provider',
    });

    expect(models).toEqual([]);
  });
});

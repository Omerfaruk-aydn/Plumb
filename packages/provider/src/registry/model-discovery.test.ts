/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Discovery adapter contract tests.
 * Verifies every registered adapter responds correctly at the HTTP boundary.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally for adapter tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  discoverProviderModels,
  getDiscoveryProviderIds,
} from './model-discovery.js';

const REGISTERED_ADAPTERS = [
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
];

describe('Discovery Adapter Registry', () => {
  it('1. has exactly 17 registered adapters', () => {
    const ids = getDiscoveryProviderIds();
    expect(ids.length).toBe(17);
  });

  it('2. all documented adapters are registered', () => {
    const ids = getDiscoveryProviderIds();
    for (const expected of REGISTERED_ADAPTERS) {
      expect(ids).toContain(expected);
    }
  });

  it('3. no duplicate provider IDs', () => {
    const ids = getDiscoveryProviderIds();
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('4. registry count matches documented count', () => {
    const ids = getDiscoveryProviderIds();
    expect(ids.length).toBe(REGISTERED_ADAPTERS.length);
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

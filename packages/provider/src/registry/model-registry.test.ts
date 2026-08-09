/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Model registry integration tests.
 * Verifies single authority, catalog integration, and discovery.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlumbModelRegistry } from './model-registry.js';
import type { PlumbModel } from '../types.js';

function makeModel(
  id: string,
  provider = 'openai',
  overrides: Partial<PlumbModel> = {},
): PlumbModel {
  return {
    id,
    name: id,
    provider,
    api: 'openai-completions',
    contextWindow: 131072,
    maxTokens: 32768,
    reasoning: false,
    input: 'text',
    ...overrides,
  };
}

describe('PlumbModelRegistry', () => {
  let registry: PlumbModelRegistry;

  beforeEach(() => {
    registry = new PlumbModelRegistry();
  });

  it('1. getModelsForProvider returns bundled catalog models', () => {
    const models = registry.getModelsForProvider('openai');
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id === 'gpt-5.5')).toBe(true);
  });

  it('2. findModel finds by ID', () => {
    const model = registry.findModel('openai', 'gpt-5.5');
    expect(model).toBeDefined();
    expect(model!.id).toBe('gpt-5.5');
  });

  it('3. findModelByReference parses provider/model', () => {
    const model = registry.findModelByReference('openai/gpt-5.5');
    expect(model).toBeDefined();
    expect(model!.provider).toBe('openai');
  });

  it('4. resolveDefaultModel uses provider default', () => {
    const model = registry.resolveDefaultModel('openai');
    expect(model).toBeDefined();
    expect(model!.id).toBe('gpt-5.5');
  });

  it('4b. findModel resolves claude-subscription on a freshly-constructed registry with no prior discovery call (cold-start restart scenario)', () => {
    // Regression: claude-subscription has no OMP catalog descriptor, so
    // without a static bundled floor (catalog/model-catalog.ts), a brand
    // new PlumbModelRegistry instance (exactly what a fresh process gets on
    // restart) would return undefined here — and plumbContentGenerator.ts
    // falls back to `api: 'openai-completions'` when that happens, silently
    // misrouting the first chat turn after restart to the wrong transport
    // instead of the Claude Agent SDK.
    const model = registry.findModel('claude-subscription', 'claude-opus-4-8');
    expect(model).toBeDefined();
    expect(model!.provider).toBe('claude-subscription');
    expect(model!.api).toBe('claude-agent-sdk');
  });

  it('4c. discoverLocalModels tags results with baseUrl and the real api dialect (regression: previously hardcoded api: openai-completions and never set baseUrl, so a selected local model always fell through to the OpenAI default and died with MISSING_CREDENTIAL)', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('11434')) {
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'llama3:8b' }] }),
        };
      }
      if (url.includes('1234')) {
        return { ok: true, json: async () => ({ data: [{ id: 'local-lm' }] }) };
      }
      return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      await registry.discoverLocalModels();

      const ollamaModel = registry.findModel('ollama', 'llama3:8b');
      expect(ollamaModel).toBeDefined();
      expect(ollamaModel!.api).toBe('ollama-chat');
      expect(ollamaModel!.baseUrl).toBe('http://127.0.0.1:11434');

      const lmStudioModel = registry.findModel('lm-studio', 'local-lm');
      expect(lmStudioModel).toBeDefined();
      expect(lmStudioModel!.api).toBe('openai-completions');
      expect(lmStudioModel!.baseUrl).toBe('http://127.0.0.1:1234');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('5. addCustomModel adds to registry', () => {
    registry.addCustomModel(makeModel('custom-model', 'openai'));
    const model = registry.findModel('openai', 'custom-model');
    expect(model).toBeDefined();
  });

  it('6. removeCustomModel removes from registry', () => {
    registry.addCustomModel(makeModel('custom-model', 'openai'));
    const removed = registry.removeCustomModel('openai', 'custom-model');
    expect(removed).toBe(true);
    expect(registry.findModel('openai', 'custom-model')).toBeUndefined();
  });

  it('7. addDiscoveredModels adds to registry', () => {
    registry.addDiscoveredModels([
      makeModel('discovered-1', 'ollama'),
      makeModel('discovered-2', 'ollama'),
    ]);
    const models = registry.getModelsForProvider('ollama');
    expect(models.some((m) => m.id === 'discovered-1')).toBe(true);
  });

  it('8. deduplicates models by ID', () => {
    registry.addDiscoveredModels([makeModel('gpt-5.5', 'openai')]);
    const models = registry.getModelsForProvider('openai');
    const gpt55 = models.filter((m) => m.id === 'gpt-5.5');
    expect(gpt55.length).toBe(1);
  });

  it('9. notifies listeners on change', () => {
    const listener = vi.fn();
    registry.subscribeToChanges(listener);
    registry.addDiscoveredModels([makeModel('new-model', 'test')]);
    expect(listener).toHaveBeenCalled();
  });

  it('10. unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsub = registry.subscribeToChanges(listener);
    unsub();
    registry.addDiscoveredModels([makeModel('new-model', 'test')]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('11. getAllModels returns models for all providers', () => {
    const all = registry.getAllModels();
    expect(all.length).toBeGreaterThan(100);
  });

  it('12. getStats returns correct counts', () => {
    registry.addDiscoveredModels([makeModel('d1', 'test')]);
    registry.addCustomModel(makeModel('c1', 'test'));
    const stats = registry.getStats();
    expect(stats.bundled).toBeGreaterThan(0);
    expect(stats.discovered).toBe(1);
    expect(stats.custom).toBe(1);
  });
});

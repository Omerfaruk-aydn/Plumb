/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlumbModel } from '../types.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';

const cache = vi.hoisted(() => ({
  entry: null as {
    models: PlumbModel[];
    fresh: boolean;
    authoritative: boolean;
    updatedAt: number;
  } | null,
  invalidate: vi.fn(),
}));

vi.mock('./model-cache.js', () => ({
  readModelCache: vi.fn(() => cache.entry),
  writeModelCache: vi.fn(),
  invalidateModelCache: cache.invalidate,
  invalidateAllModelCache: vi.fn(),
}));

import { PlumbModelRegistry } from './model-registry.js';

function localModel(baseUrl?: string): PlumbModel {
  return {
    id: 'served-model',
    name: 'Served model',
    provider: 'vllm',
    api: 'openai-completions',
    baseUrl,
    contextWindow: 131072,
    maxTokens: 32768,
    reasoning: false,
    input: 'text',
    source: 'SERVER_DYNAMIC',
  };
}

describe('local model cache endpoint isolation', () => {
  beforeEach(() => {
    cache.invalidate.mockClear();
    setProviderConfigResolver(() => ({
      baseUrl: 'http://127.0.0.1:9000/v1',
    }));
  });

  afterEach(() => {
    cache.entry = null;
    setProviderConfigResolver(undefined);
  });

  it('rejects and removes models discovered from a different endpoint', () => {
    cache.entry = {
      models: [localModel('http://127.0.0.1:8000/v1')],
      fresh: true,
      authoritative: true,
      updatedAt: Date.now(),
    };
    const registry = new PlumbModelRegistry();

    expect(registry.loadCache('vllm')).toEqual([]);
    expect(registry.findModel('vllm', 'served-model')).toBeUndefined();
    expect(cache.invalidate).toHaveBeenCalledWith('vllm');
  });

  it('hydrates models only when their endpoint matches current configuration', () => {
    cache.entry = {
      models: [localModel('http://127.0.0.1:9000/v1/')],
      fresh: true,
      authoritative: true,
      updatedAt: Date.now(),
    };
    const registry = new PlumbModelRegistry();

    expect(registry.loadCache('vllm')).toHaveLength(1);
    expect(registry.findModel('vllm', 'served-model')?.baseUrl).toBe(
      'http://127.0.0.1:9000/v1/',
    );
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('rejects legacy local cache entries without endpoint provenance', () => {
    cache.entry = {
      models: [localModel(undefined)],
      fresh: true,
      authoritative: true,
      updatedAt: Date.now(),
    };
    const registry = new PlumbModelRegistry();

    expect(registry.loadCache('vllm')).toEqual([]);
    expect(cache.invalidate).toHaveBeenCalledWith('vllm');
  });
});

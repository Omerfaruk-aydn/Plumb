/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  SELECTABLE_PROVIDERS,
  getProvidersByCategory,
  getPlumbProvider,
} from '../catalog/providers.js';
import { PlumbProviderCategory } from '../types.js';
import {
  PLUMB_INVENTORY_FIXTURE,
  REFERENCE_ROUTES,
} from './__fixtures__/plumbInventory.js';

describe('PLUMB reference-route regression', () => {
  it('inventory fixture declares all six reference routes', () => {
    for (const id of REFERENCE_ROUTES) {
      const row = PLUMB_INVENTORY_FIXTURE.find((r) => r.id === id);
      expect(row, `inventory row missing for ${id}`).toBeDefined();
      expect(row?.finalClassification).toBe('PRODUCTION_READY');
    }
  });

  it('NVIDIA is selectable in the live catalog', () => {
    const provider = getPlumbProvider('nvidia');
    expect(provider, 'nvidia must be in PLUMB_PROVIDERS').toBeDefined();
    expect(provider?.available).toBe(true);
    expect(provider?.category).toBe(PlumbProviderCategory.API_KEY);
    const inSelectable = SELECTABLE_PROVIDERS.some((p) => p.id === 'nvidia');
    expect(inSelectable, 'nvidia must be selectable').toBe(true);
  });

  it('every local reference route is selectable', () => {
    const locals = ['ollama', 'lm-studio', 'llama-cpp', 'vllm'];
    for (const id of locals) {
      const provider = getPlumbProvider(id);
      expect(provider, `${id} must be in PLUMB_PROVIDERS`).toBeDefined();
      expect(provider?.available, `${id} must be available`).toBe(true);
      expect(provider?.category).toBe(PlumbProviderCategory.LOCAL);
      const inSelectable = SELECTABLE_PROVIDERS.some((p) => p.id === id);
      expect(inSelectable, `${id} must be selectable`).toBe(true);
    }
  });

  it('getProvidersByCategory(LOCAL) returns at least the four verified routes', () => {
    const locals = getProvidersByCategory(PlumbProviderCategory.LOCAL);
    const ids = locals.map((p) => p.id);
    for (const expected of ['ollama', 'lm-studio', 'llama-cpp', 'vllm']) {
      expect(ids, `${expected} must be in LOCAL category`).toContain(expected);
    }
  });

  it('keeps each optional local credential bound to its own provider', () => {
    const expected = new Map([
      ['ollama', 'OLLAMA_API_KEY'],
      ['lm-studio', 'LM_STUDIO_API_KEY'],
      ['llama-cpp', 'LLAMA_CPP_API_KEY'],
      ['vllm', 'VLLM_API_KEY'],
      ['sglang', 'SGLANG_API_KEY'],
    ]);

    for (const [id, envVar] of expected) {
      const apiKeyMethods = getPlumbProvider(id)?.authMethods.filter(
        (method) => method.type === 'api_key',
      );
      expect(apiKeyMethods, `${id} API-key method`).toEqual([
        { type: 'api_key', envVar },
      ]);
    }

    expect(getPlumbProvider('claude-subscription')?.authMethods).toEqual([
      { type: 'none' },
    ]);
  });

  it('custom-openai-compat is a PLUMB-only synthetic exposed via the dialog', () => {
    // The custom endpoint is not in SELECTABLE_PROVIDERS because it is a
    // PLUMB-only synthetic surfaced through the dialog's "Advanced" fallback
    // (CUSTOM_ENDPOINT category) in the dialog itself. It must resolve to a
    // PlumbProvider of category CUSTOM_ENDPOINT so the dialog can render it.
    const provider = getPlumbProvider('custom-openai-compat');
    expect(
      provider,
      'custom-openai-compat must be in PLUMB_PROVIDERS',
    ).toBeDefined();
    expect(provider?.category).toBe(PlumbProviderCategory.CUSTOM_ENDPOINT);
  });

  it('reference-route ids are a subset of the catalog', () => {
    for (const id of REFERENCE_ROUTES) {
      const provider = getPlumbProvider(id);
      expect(provider, `catalog missing reference id ${id}`).toBeDefined();
    }
  });
});

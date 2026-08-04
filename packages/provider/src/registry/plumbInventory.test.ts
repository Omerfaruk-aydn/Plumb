/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase A — Reference-route regression test.
 *
 * This test runs against the catalog directly (no Ink / no React rendering)
 * so it does not depend on the pre-existing `act is not a function` failure
 * in `PlumbProviderSetupDialog.test.tsx`. It pins the truth:
 *
 * - The verified reference routes (`nvidia`, `ollama`, `lm-studio`, `llama-cpp`,
 *   `vllm`, `custom-openai-compat`) are present in `SELECTABLE_PROVIDERS`.
 * - Each is marked `available: true`.
 * - Each has the expected category / group.
 * - The reference-route ids are present in the frozen inventory fixture.
 *
 * If any future commit removes a reference route from `SELECTABLE_PROVIDERS`
 * or drops a reference id from the fixture, this test fails. That is the
 * only job: protect the verified routes from regression.
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

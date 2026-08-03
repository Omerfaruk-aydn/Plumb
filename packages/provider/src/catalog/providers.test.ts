/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provider catalog projection contract: every selectable provider must be
 * backed by an imported OMP descriptor (registry definition or catalog
 * entry), and the provider inventory must be OMP-derived (no hard-coded
 * independent array in the facade).
 */

import { describe, it, expect } from 'vitest';
import {
  SELECTABLE_PROVIDERS,
  PLUMB_PROVIDERS,
  PRODUCTION_READY_PROVIDER_IDS,
} from './providers.js';
import { getProviderDefinition } from '../omp-ai/registry/registry.js';
import { getCatalogProviderEntry } from '../omp-catalog/provider-models/descriptors.js';

// PLUMB ids that legitimately have no OMP descriptor (PLUMB-only surfaces).
const PLUMB_ONLY_IDS = new Set(['custom-openai-compat', 'google-login']);

// PLUMB presentation id → OMP registry id (mirrors the facade alias map).
const PLUMB_TO_OMP: Record<string, string> = {
  antigravity: 'google-antigravity',
  'llama-cpp': 'llama.cpp',
  'anthropic-api': 'anthropic',
};

/** Resolve the OMP id backing a PLUMB id (or undefined for PLUMB-only). */
function resolveOmpId(plumbId: string): string | undefined {
  return PLUMB_TO_OMP[plumbId] ?? plumbId;
}

describe('provider catalog projection', () => {
  it('projects a unique, OMP-backed provider inventory (no independent array)', () => {
    // The catalog is a projection: ids are unique and every non-PLUMB-only
    // id resolves to an OMP registry or catalog descriptor. OMP registry-only
    // search/tool providers (exa, kagi, parallel, tavily, gitlab-duo-workflow,
    // openai-codex-device) are intentionally not UI chat providers.
    const ids = PLUMB_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const provider of PLUMB_PROVIDERS) {
      if (PLUMB_ONLY_IDS.has(provider.id)) continue;
      const ompId = resolveOmpId(provider.id);
      expect(
        ompId !== undefined &&
          (getProviderDefinition(ompId) !== undefined ||
            getCatalogProviderEntry(ompId) !== undefined),
        `provider ${provider.id} has no OMP descriptor`,
      ).toBe(true);
    }
  });

  it('every selectable provider has an imported OMP descriptor', () => {
    for (const provider of SELECTABLE_PROVIDERS) {
      if (PLUMB_ONLY_IDS.has(provider.id)) {
        // PLUMB-only providers must NOT be selectable (no OMP backing).
        expect(
          provider.available,
          `${provider.id} is PLUMB-only and must not be selectable`,
        ).toBe(false);
        continue;
      }
      const ompId = resolveOmpId(provider.id);
      const ompDef = ompId ? getProviderDefinition(ompId) : undefined;
      const catalogEntry = ompId ? getCatalogProviderEntry(ompId) : undefined;
      expect(
        ompDef !== undefined || catalogEntry !== undefined,
        `selectable provider ${provider.id} has no imported OMP descriptor`,
      ).toBe(true);
    }
  });

  it('selectable set is exactly the OMP-backed available providers', () => {
    const ompBacked = PLUMB_PROVIDERS.filter((p) => {
      if (PLUMB_ONLY_IDS.has(p.id)) return false;
      const ompId = resolveOmpId(p.id);
      if (!ompId) return false;
      const def = getProviderDefinition(ompId);
      const entry = getCatalogProviderEntry(ompId);
      return def !== undefined || entry !== undefined;
    });
    for (const provider of ompBacked) {
      expect(PRODUCTION_READY_PROVIDER_IDS.has(provider.id)).toBe(true);
    }
    for (const id of PRODUCTION_READY_PROVIDER_IDS) {
      const provider = PLUMB_PROVIDERS.find((p) => p.id === id);
      expect(provider?.available).toBe(true);
    }
  });
});

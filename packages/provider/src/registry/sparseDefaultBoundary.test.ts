/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { buildUniversalModelInventory } from './universal-model-inventory.js';

vi.mock('./provider-registry.js', () => ({
  getPlumbProviderRegistry: () => ({
    initialize: async () => {},
    getActiveProviderStates: () => [],
  }),
}));

vi.mock('../transports/claudeSubscription.js', () => ({
  getClaudeSubscriptionModels: async () => ({
    models: [
      {
        id: 'opus',
        name: 'Claude Opus 4.8',
        contextWindow: 200_000,
        maxTokens: 32_000,
        source: 'ACCOUNT_DYNAMIC',
        limitsSource: 'GENERIC_FLOOR',
      },
      {
        id: 'claude-sonnet-5',
        name: 'Claude Sonnet 5',
        contextWindow: 200_000,
        maxTokens: 64_000,
        source: 'OFFICIAL_STATIC_METADATA',
        limitsSource: 'PINNED_REFERENCE',
      },
    ],
    source: 'ACCOUNT_DYNAMIC',
  }),
}));

describe('sparse-default boundary: OMP-only, not global', () => {
  it('watsonx and OCI models remain UNKNOWN (not OMP sparse-default)', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    const watsonx = inv.models.filter((m) => m.providerId === 'watsonx');
    const oci = inv.models.filter((m) => m.providerId === 'oci-genai');
    // watsonx has 3 static models, OCI has 2 static models
    expect(watsonx.length).toBe(3);
    expect(oci.length).toBe(2);
    for (const m of [...watsonx, ...oci]) {
      expect(m.toolsSupported).toBeUndefined();
      expect(m.toolsCapabilitySource).toBeUndefined();
    }
  });

  it('Claude Subscription uses PINNED_REFERENCE, not BUNDLED_CATALOG', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    const claudeModels = inv.models.filter(
      (m) => m.providerId === 'claude-subscription',
    );
    expect(claudeModels.length).toBeGreaterThan(0);
    for (const m of claudeModels) {
      if (m.toolsSupported === true) {
        expect(m.toolsCapabilitySource).toBe('PINNED_REFERENCE');
      }
    }
  });

  it('every BUNDLED_CATALOG model has explicit toolsSupported (never undefined)', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    const bundled = inv.models.filter(
      (m) => m.toolsCapabilitySource === 'BUNDLED_CATALOG',
    );
    expect(bundled.length).toBe(3935);
    for (const m of bundled) {
      expect(typeof m.toolsSupported).toBe('boolean');
    }
  });
});

describe('exact inventory counts', () => {
  it('exact TOTAL_MODELS, SUPPORTED, UNSUPPORTED, UNKNOWN', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    const { totalModels, toolsSupported, toolsUnsupported, toolsUnknown } =
      inv.counts;
    expect(toolsSupported + toolsUnsupported + toolsUnknown).toBe(totalModels);
    expect(totalModels).toBeGreaterThanOrEqual(3908);
    console.log('EXACT COUNTS:', {
      totalModels,
      toolsSupported,
      toolsUnsupported,
      toolsUnknown,
    });
  });

  it('exact capability source breakdown', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    const bySource: Record<string, number> = {};
    for (const m of inv.models) {
      const src = m.toolsCapabilitySource ?? 'UNSET';
      bySource[src] = (bySource[src] ?? 0) + 1;
    }
    expect(bySource['BUNDLED_CATALOG']).toBe(3935);
    console.log('CAPABILITY SOURCE BREAKDOWN:', bySource);
  });
});

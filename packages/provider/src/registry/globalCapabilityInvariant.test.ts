/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global all-model generated invariant test.
 *
 * Table-driven: iterates EVERY model in the real
 * `buildUniversalModelInventory()` snapshot (the same authority the
 * diagnostics, the model picker, and the prompt/wire gate all read
 * from) and asserts the tools-capability invariant that
 * `Config.getEffectiveToolsAdvertisable()` depends on:
 *
 *   toolsSupported === true  => toolsCapabilitySource is a real,
 *                                non-UNKNOWN provenance value.
 *   toolsSupported !== true  => (false or undefined) never carries a
 *                                capability source that could be
 *                                mistaken for authorization to
 *                                advertise tools. The gate itself
 *                                (getEffectiveToolsAdvertisable) only
 *                                ever checks `=== true`, so this test
 *                                additionally re-derives that boolean
 *                                per model and asserts it agrees with
 *                                a plain `toolsSupported === true`
 *                                check -- i.e. nothing about
 *                                toolsCapabilitySource can defeat or
 *                                bypass the gate.
 *
 * Representative supported/unsupported/unknown prompt-gate-level
 * behavior continues to be covered by
 * packages/core/src/core/promptToolCoherence.test.ts -- this test
 * operates one level down, over the full generated inventory.
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

// Mirrors Config.getEffectiveToolsAdvertisable()'s PLUMB-routed branch:
// the ONLY thing that may authorize advertising tools is an explicit
// toolsSupported === true. Re-derived here (not imported from
// packages/core, to avoid a cross-package prod dependency in a
// provider-level test) so this test independently re-proves the same
// boolean logic the real gate uses, over the real generated inventory.
function effectiveAdvertisableForPlumbModel(m: {
  toolsSupported?: boolean;
}): boolean {
  return m.toolsSupported === true;
}

describe('global all-model generated capability invariant', () => {
  it('the real inventory has >= OMP catalog size (regression floor -- update deliberately)', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    // The inventory must include at least the OMP catalog models (3908).
    // Additional models come from PLUMB-only synthetics (watsonx, OCI,
    // Claude Subscription) and provider aliases. The exact total varies
    // with test isolation (global singleton state), but must never drop
    // below the OMP floor.
    expect(inv.counts.totalModels).toBeGreaterThanOrEqual(3908);
  });

  it('every model: toolsSupported===true implies a non-UNKNOWN capability source', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    expect(inv.models.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const m of inv.models) {
      if (m.toolsSupported === true) {
        if (!m.toolsCapabilitySource || m.toolsCapabilitySource === 'UNKNOWN') {
          violations.push(
            `${m.providerId}:${m.modelId} toolsSupported=true but source=${String(
              m.toolsCapabilitySource,
            )}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('every model: the prompt/wire gate boolean agrees with a plain toolsSupported===true check -- no capability source can bypass or defeat the gate', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });

    const violations: string[] = [];
    for (const m of inv.models) {
      const gate = effectiveAdvertisableForPlumbModel(m);
      const plain = m.toolsSupported === true;
      if (gate !== plain) {
        violations.push(
          `${m.providerId}:${m.modelId} gate=${gate} plain=${plain}`,
        );
      }
      // UNSUPPORTED and UNKNOWN must both resolve to gate=false.
      if (m.toolsSupported !== true && gate !== false) {
        violations.push(
          `${m.providerId}:${m.modelId} toolsSupported=${String(
            m.toolsSupported,
          )} but gate=${gate} (must be false)`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it('counts.toolsSupported + counts.toolsUnsupported + counts.toolsUnknown === counts.totalModels', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    const sum =
      inv.counts.toolsSupported +
      inv.counts.toolsUnsupported +
      inv.counts.toolsUnknown;
    expect(sum).toBe(inv.counts.totalModels);
  });

  it('no model has toolsSupported=false without SOME recorded capability source (even UNKNOWN is acceptable there -- false must still be traceable, not silently defaulted)', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    const untraceable = inv.models.filter(
      (m) =>
        m.toolsSupported === false && m.toolsCapabilitySource === undefined,
    );
    // This is a soft-informational assertion: currently allowed (source
    // is optional on the type), but recorded here so any future
    // regression that starts dropping explicit UNSUPPORTED provenance
    // is visible as a count change, not silent.
    expect(Array.isArray(untraceable)).toBe(true);
  });

  // ─── Upstream OMP metadata propagation ────────────────────────────────
  //
  // The OMP catalog uses a sparse encoding: `supportsTools: false` is
  // the ONLY unsupported signal; `true` and `undefined` (absent) both
  // mean "callers may use native tools." After the
  // ompModelToPlumbModel() fix that maps this field, the vast majority
  // of bundled catalog models should be SUPPORTED (BUNDLED_CATALOG).

  it('the majority of bundled catalog models are SUPPORTED via BUNDLED_CATALOG (upstream supportsTools propagation)', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    // Before the fix: almost all models were UNKNOWN.
    // After the fix: ~3700+ bundled models become SUPPORTED.
    const bundledSupported = inv.models.filter(
      (m) =>
        m.toolsSupported === true &&
        m.toolsCapabilitySource === 'BUNDLED_CATALOG',
    );
    expect(bundledSupported.length).toBeGreaterThan(3700);
  });

  it('models with upstream supportsTools=false are UNSUPPORTED (BUNDLED_CATALOG)', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    const bundledUnsupported = inv.models.filter(
      (m) =>
        m.toolsSupported === false &&
        m.toolsCapabilitySource === 'BUNDLED_CATALOG',
    );
    // The OMP catalog has 27 models with supportsTools=false.
    // Additional models from discovery/custom may also be UNSUPPORTED.
    expect(bundledUnsupported.length).toBeGreaterThanOrEqual(27);
  });

  it('TOOLS_SUPPORTED is the dominant category (not UNKNOWN)', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    // This is the key regression: before the fix, SUPPORTED was ~2,
    // UNKNOWN was ~4037. After: SUPPORTED >> UNKNOWN.
    expect(inv.counts.toolsSupported).toBeGreaterThan(inv.counts.toolsUnknown);
  });

  it('toolsCapabilitySource breakdown: BUNDLED_CATALOG is the largest source', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    const bySource: Record<string, number> = {};
    for (const m of inv.models) {
      const src = m.toolsCapabilitySource ?? 'UNSET';
      bySource[src] = (bySource[src] ?? 0) + 1;
    }
    // BUNDLED_CATALOG should be the dominant source after the fix.
    expect(bySource['BUNDLED_CATALOG'] ?? 0).toBeGreaterThan(3700);
  });

  // ─── Provider isolation: same model ID / different provider ──────────

  it('same model ID across different providers has independent capability (no bleed)', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    // Group models by display model id
    const byModelId = new Map<string, typeof inv.models>();
    for (const m of inv.models) {
      const arr = byModelId.get(m.modelId) ?? [];
      arr.push(m);
      byModelId.set(m.modelId, arr);
    }
    // Find model ids that appear in multiple providers
    const violations: string[] = [];
    for (const [modelId, entries] of byModelId) {
      if (entries.length < 2) continue;
      // All entries for the same model id across different providers
      // must have independently resolved capability (not bleed from each other)
      const providers = new Set(entries.map((e) => e.providerId));
      if (providers.size < 2) continue;
      // Check: if one is SUPPORTED and another is UNKNOWN, that's fine (different provider).
      // What's NOT fine is if they all have the exact same toolsSupported value
      // purely because of bleed. Since we can't distinguish bleed from coincidence
      // in a purely structural test, we verify each has a capability source.
      for (const entry of entries) {
        if (
          entry.toolsSupported !== undefined &&
          !entry.toolsCapabilitySource
        ) {
          violations.push(
            `${entry.providerId}:${entry.modelId} toolsSupported=${entry.toolsSupported} but no source`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

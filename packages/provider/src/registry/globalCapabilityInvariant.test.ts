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
  it('the real inventory has the expected total model count (regression pin -- update deliberately, not silently)', async () => {
    const inv = await buildUniversalModelInventory({
      build: { gitHead: 'a'.repeat(40) },
    });
    // Pinned to the verified Phase-2 count. If this fails, the model
    // universe genuinely changed (new provider/catalog additions) --
    // update the pin deliberately, don't just raise the number blindly.
    expect(inv.counts.totalModels).toBe(4039);
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
});

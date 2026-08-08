/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression: `claude-subscription` (a PLUMB-only synthetic with no OMP
 * catalog descriptor) must have a static model floor so a cold process
 * restart with a persisted claude-subscription/model selection resolves the
 * correct wire dialect (`claude-agent-sdk`) on the very first chat turn,
 * without depending on a live discovery call having already run.
 */
import { describe, it, expect } from 'vitest';
import { getCatalogModels, getCatalogModel } from './model-catalog.js';
import { CLAUDE_SUBSCRIPTION_MODELS } from '../transports/claudeSubscription.js';

describe('claude-subscription static catalog floor', () => {
  it('getCatalogModels returns real Anthropic models tagged with the claude-agent-sdk dialect and provider', () => {
    const models = getCatalogModels('claude-subscription');

    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.provider).toBe('claude-subscription');
      expect(model.api).toBe('claude-agent-sdk');
      // Real bundled Anthropic model ids, not synthetic/placeholder ids.
      expect(model.id).toMatch(/^claude-/);
    }
  });

  it('getCatalogModel resolves a specific model by id with the same overrides', () => {
    const [first] = getCatalogModels('claude-subscription');
    expect(first).toBeDefined();

    const resolved = getCatalogModel('claude-subscription', first!.id);

    expect(resolved).toBeDefined();
    expect(resolved!.provider).toBe('claude-subscription');
    expect(resolved!.api).toBe('claude-agent-sdk');
    expect(resolved!.id).toBe(first!.id);
  });

  it('does not misroute claude-subscription models to the raw anthropic-api provider id', () => {
    // The regression this guards against: before the fix, claude-subscription
    // had no models.json entry, so getCatalogModels returned []. A naive fix
    // of aliasing it to the 'anthropic' bundled catalog (without overriding
    // provider/api) would have made these models carry provider: 'anthropic'
    // and api: 'anthropic-messages' — silently routing Agent-SDK-intended
    // requests through the disabled raw OAuth / direct API-key path instead.
    const models = getCatalogModels('claude-subscription');
    for (const model of models) {
      expect(model.provider).not.toBe('anthropic');
      expect(model.api).not.toBe('anthropic-messages');
    }
  });

  it('exposes exactly the pinned Agent SDK model aliases — not the full Anthropic API catalog', () => {
    // The Agent SDK's query() only accepts a small, pinned set of model
    // aliases (CLAUDE_SUBSCRIPTION_MODELS), not arbitrary Anthropic
    // Developer Platform model ids. Regression: an earlier version of this
    // fix reused getBundledModels('anthropic') directly (the full API
    // catalog — dozens of model ids), which would let a user pick a model
    // id the SDK does not accept and misrepresented the source's real
    // provenance (a fixed static list, not a proper catalog).
    const models = getCatalogModels('claude-subscription');
    expect(models.length).toBe(CLAUDE_SUBSCRIPTION_MODELS.length);
    const expectedIds = new Set(CLAUDE_SUBSCRIPTION_MODELS.map((m) => m.id));
    for (const model of models) {
      expect(expectedIds.has(model.id)).toBe(true);
    }
  });

  it('omits per-token pricing (subscription usage is not metered the way API billing is)', () => {
    const models = getCatalogModels('claude-subscription');
    for (const model of models) {
      expect(model.pricing).toBeUndefined();
    }
  });

  it('other providers are unaffected by the claude-subscription special case', () => {
    const anthropicModels = getCatalogModels('anthropic-api');
    expect(anthropicModels.length).toBeGreaterThan(0);
    for (const model of anthropicModels) {
      expect(model.api).toBe('anthropic-messages');
    }
  });
});

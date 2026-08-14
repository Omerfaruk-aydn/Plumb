/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlumbModel } from '../types.js';

const state = vi.hoisted(() => ({
  cacheEntry: null as {
    models: PlumbModel[];
    fresh: boolean;
    authoritative: boolean;
    updatedAt: number;
  } | null,
  discoveryResult: { models: [] as unknown[], status: 'empty' as string },
}));

vi.mock('./model-cache.js', () => ({
  readModelCache: vi.fn(() => state.cacheEntry),
  writeModelCache: vi.fn(),
  invalidateModelCache: vi.fn(),
  invalidateAllModelCache: vi.fn(),
}));

vi.mock('./model-discovery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./model-discovery.js')>();
  return {
    ...actual,
    discoverProviderModelsDetailed: vi.fn(async () => state.discoveryResult),
  };
});

import { PlumbModelRegistry } from './model-registry.js';

function cachedModel(id: string, provider = 'github-copilot'): PlumbModel {
  return {
    id,
    name: id,
    provider,
    api: 'openai-responses',
    contextWindow: 131072,
    maxTokens: 32768,
    input: 'text',
    source: 'PROVIDER_DYNAMIC',
  };
}

describe('fresh cache contract (attemptAuthoritativeDiscovery)', () => {
  let registry: PlumbModelRegistry;

  beforeEach(() => {
    registry = new PlumbModelRegistry();
    state.cacheEntry = null;
    state.discoveryResult = { models: [], status: 'empty' };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('A. a fresh, authoritative, non-empty cache is honestly hydrated when the live attempt returns empty (core invariant)', async () => {
    state.cacheEntry = {
      models: Array.from({ length: 79 }, (_, i) =>
        cachedModel(`copilot-model-${i}`),
      ),
      fresh: true,
      authoritative: true,
      updatedAt: Date.now(),
    };
    state.discoveryResult = { models: [], status: 'empty' };

    const result = await registry.attemptAuthoritativeDiscovery(
      'github-copilot',
      'token',
    );

    expect(result.state).toBe('SUCCEEDED_NONEMPTY');
    expect(result.models).toHaveLength(79);
    const stats = registry.getModelAuthorityStats('github-copilot');
    expect(stats.discoveryState).toBe('SUCCEEDED_NONEMPTY');
    expect(stats.liveDiscoveryCount).toBe(79);
    // The exact contradiction from the live evidence must be impossible:
    // a fresh nonempty cache can never coexist with an effective zero.
    expect(stats.liveDiscoveryCount).toBeGreaterThan(0);
  });

  it('a stale cache is NOT used to override a genuine live-empty result', async () => {
    state.cacheEntry = {
      models: [cachedModel('stale-model')],
      fresh: false,
      authoritative: true,
      updatedAt: Date.now() - 999_999_999,
    };
    state.discoveryResult = { models: [], status: 'empty' };

    const result = await registry.attemptAuthoritativeDiscovery(
      'github-copilot',
      'token',
    );

    expect(result.state).toBe('SUCCEEDED_EMPTY');
    expect(
      registry.getModelAuthorityStats('github-copilot').liveDiscoveryCount,
    ).toBe(0);
  });

  it("E. a cache row whose models carry a different provider id is never trusted as this provider's authority (alias/orphaning guard)", async () => {
    state.cacheEntry = {
      // Cache slot requested under github-copilot but the stored models
      // carry a backing/alias provider id — must not be treated as this
      // provider's authoritative non-empty set.
      models: [cachedModel('leaked-model', 'github-copilot-omp-backing')],
      fresh: true,
      authoritative: true,
      updatedAt: Date.now(),
    };
    state.discoveryResult = { models: [], status: 'empty' };

    const result = await registry.attemptAuthoritativeDiscovery(
      'github-copilot',
      'token',
    );

    expect(result.state).toBe('SUCCEEDED_EMPTY');
    expect(
      registry.getModelAuthorityStats('github-copilot').liveDiscoveryCount,
    ).toBe(0);
  });

  it('H. a valid EMPTY cache stays distinct from a valid NONEMPTY cache — never silently reclassified', async () => {
    state.cacheEntry = {
      models: [],
      fresh: true,
      authoritative: true,
      updatedAt: Date.now(),
    };
    state.discoveryResult = { models: [], status: 'empty' };

    const result = await registry.attemptAuthoritativeDiscovery(
      'github-copilot',
      'token',
    );

    // Empty cache has no models to hydrate from, so the honest live-empty
    // result stands — this must remain SUCCEEDED_EMPTY, never fabricated
    // as nonempty.
    expect(result.state).toBe('SUCCEEDED_EMPTY');
  });

  it('a genuinely successful nonempty live result is unaffected by cache presence', async () => {
    state.cacheEntry = {
      models: [cachedModel('cached-only')],
      fresh: true,
      authoritative: true,
      updatedAt: Date.now(),
    };
    state.discoveryResult = {
      models: [{ id: 'live-model', api: 'openai-responses' }],
      status: 'success',
    };

    const result = await registry.attemptAuthoritativeDiscovery(
      'github-copilot',
      'token',
    );

    expect(result.state).toBe('SUCCEEDED_NONEMPTY');
    expect(result.models.map((m) => m.id)).toEqual(['live-model']);
  });
});

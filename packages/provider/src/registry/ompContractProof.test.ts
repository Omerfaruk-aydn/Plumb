/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { buildUniversalModelInventory } from './universal-model-inventory.js';
import { ompModelToPlumbModel } from '../catalog/model-catalog.js';

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

describe('OMP supportsTools contract proof', () => {
  it('models.json: 3908 models, 89 true, 27 false, 3792 absent', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const models = require('../vendor-catalog/models.json') as Record<
      string,
      Record<string, { supportsTools?: boolean }>
    >;
    let total = 0;
    let exTrue = 0;
    let exFalse = 0;
    let absent = 0;
    for (const providerModels of Object.values(models)) {
      for (const model of Object.values(providerModels)) {
        total++;
        if (model.supportsTools === true) exTrue++;
        else if (model.supportsTools === false) exFalse++;
        else absent++;
      }
    }
    expect(total).toBe(3908);
    expect(exTrue).toBe(89);
    expect(exFalse).toBe(27);
    expect(absent).toBe(3792);
    expect(exTrue + exFalse + absent).toBe(3908);
  });

  it('ompModelToPlumbModel: supportsTools=false → toolsSupported=false, source=BUNDLED_CATALOG', () => {
    const spec = {
      id: 'test-unsupported',
      provider: 'test',
      name: 'Test',
      api: 'openai-completions',
      contextWindow: 128000,
      maxTokens: 4096,
      reasoning: false,
      input: 'text',
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      supportsTools: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = ompModelToPlumbModel(spec);
    expect(result.toolsSupported).toBe(false);
    expect(result.toolsCapabilitySource).toBe('BUNDLED_CATALOG');
  });

  it('ompModelToPlumbModel: supportsTools=true → toolsSupported=true, source=BUNDLED_CATALOG', () => {
    const spec = {
      id: 'test-supported',
      provider: 'test',
      name: 'Test',
      api: 'openai-completions',
      contextWindow: 128000,
      maxTokens: 4096,
      reasoning: false,
      input: 'text',
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      supportsTools: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = ompModelToPlumbModel(spec);
    expect(result.toolsSupported).toBe(true);
    expect(result.toolsCapabilitySource).toBe('BUNDLED_CATALOG');
  });

  it('ompModelToPlumbModel: supportsTools absent → toolsSupported=true (OMP sparse default), source=BUNDLED_CATALOG', () => {
    const spec = {
      id: 'test-sparse',
      provider: 'test',
      name: 'Test',
      api: 'openai-completions',
      contextWindow: 128000,
      maxTokens: 4096,
      reasoning: false,
      input: 'text',
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = ompModelToPlumbModel(spec);
    expect(result.toolsSupported).toBe(true);
    expect(result.toolsCapabilitySource).toBe('BUNDLED_CATALOG');
  });
});

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlumbModelRegistry, composeModel } from './model-registry.js';
import type { PlumbModel } from '../types.js';
import {
  getPlumbProviderRegistry,
  resetPlumbProviderRegistry,
} from './provider-registry.js';

function makeModel(
  id: string,
  provider = 'openai',
  overrides: Partial<PlumbModel> = {},
): PlumbModel {
  return {
    id,
    name: id,
    provider,
    api: 'openai-completions',
    contextWindow: 131072,
    maxTokens: 32768,
    reasoning: false,
    input: 'text',
    ...overrides,
  };
}

describe('PlumbModelRegistry', () => {
  let registry: PlumbModelRegistry;

  beforeEach(() => {
    registry = new PlumbModelRegistry();
  });

  afterEach(() => {
    resetPlumbProviderRegistry();
    vi.unstubAllGlobals();
  });

  it('1. getModelsForProvider returns bundled catalog models', () => {
    const models = registry.getModelsForProvider('openai');
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id === 'gpt-5.5')).toBe(true);
  });

  it('2. findModel finds by ID', () => {
    const model = registry.findModel('openai', 'gpt-5.5');
    expect(model).toBeDefined();
    expect(model!.id).toBe('gpt-5.5');
  });

  it('3. findModelByReference parses provider/model', () => {
    const model = registry.findModelByReference('openai/gpt-5.5');
    expect(model).toBeDefined();
    expect(model!.provider).toBe('openai');
  });

  it('4. resolveDefaultModel uses provider default', () => {
    const model = registry.resolveDefaultModel('openai');
    expect(model).toBeDefined();
    expect(model!.id).toBe('gpt-5.5');
  });

  it('4b. findModel resolves claude-subscription on a freshly-constructed registry with no prior discovery call (cold-start restart scenario)', () => {
    // Regression: claude-subscription has no OMP catalog descriptor, so
    // without a static bundled floor (catalog/model-catalog.ts), a brand
    // new PlumbModelRegistry instance (exactly what a fresh process gets on
    // restart) would return undefined here — and plumbContentGenerator.ts
    // falls back to `api: 'openai-completions'` when that happens, silently
    // misrouting the first chat turn after restart to the wrong transport
    // instead of the Claude Agent SDK.
    const model = registry.findModel('claude-subscription', 'claude-opus-4-8');
    expect(model).toBeDefined();
    expect(model!.provider).toBe('claude-subscription');
    expect(model!.api).toBe('claude-agent-sdk');
  });

  it('4c. discoverLocalModels tags results with baseUrl and the real api dialect (regression: previously hardcoded api: openai-completions and never set baseUrl, so a selected local model always fell through to the OpenAI default and died with MISSING_CREDENTIAL)', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('11434')) {
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'llama3:8b' }] }),
        };
      }
      if (url.includes('1234')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'lmstudio-community/local-lm' }],
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      await registry.discoverLocalModels();

      const ollamaModel = registry.findModel('ollama', 'llama3:8b');
      expect(ollamaModel).toBeDefined();
      expect(ollamaModel!.api).toBe('ollama-chat');
      expect(ollamaModel!.baseUrl).toBe('http://127.0.0.1:11434/v1');
      expect(ollamaModel!.source).toBe('SERVER_DYNAMIC');

      const lmStudioModel = registry.findModel(
        'lm-studio',
        'lmstudio-community/local-lm',
      );
      expect(lmStudioModel).toBeDefined();
      expect(lmStudioModel!.api).toBe('openai-completions');
      expect(lmStudioModel!.baseUrl).toBe('http://127.0.0.1:1234/v1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('4d. records local server health without treating an offline server as an auth failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );

    await registry.discoverProviderModels('sglang');

    expect(getPlumbProviderRegistry().getProviderState('sglang')).toMatchObject(
      {
        authState: 'authenticated',
        healthState: 'offline',
        healthErrorCode: 'SERVER_UNAVAILABLE',
      },
    );
  });

  it('4e. treats a valid empty local catalog as online', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [] }), { status: 200 }),
        ),
    );

    await registry.discoverProviderModels('sglang');

    expect(getPlumbProviderRegistry().getProviderState('sglang')).toMatchObject(
      {
        authState: 'authenticated',
        healthState: 'online',
      },
    );
  });

  it('5. addCustomModel adds to registry', () => {
    registry.addCustomModel(makeModel('custom-model', 'openai'));
    const model = registry.findModel('openai', 'custom-model');
    expect(model).toBeDefined();
  });

  it('6. removeCustomModel removes from registry', () => {
    registry.addCustomModel(makeModel('custom-model', 'openai'));
    const removed = registry.removeCustomModel('openai', 'custom-model');
    expect(removed).toBe(true);
    expect(registry.findModel('openai', 'custom-model')).toBeUndefined();
  });

  it('7. addDiscoveredModels adds to registry', () => {
    registry.addDiscoveredModels([
      makeModel('discovered-1', 'ollama'),
      makeModel('discovered-2', 'ollama'),
    ]);
    const models = registry.getModelsForProvider('ollama');
    expect(models.some((m) => m.id === 'discovered-1')).toBe(true);
  });

  it('8. deduplicates models by ID', () => {
    registry.addDiscoveredModels([makeModel('gpt-5.5', 'openai')]);
    const models = registry.getModelsForProvider('openai');
    const gpt55 = models.filter((m) => m.id === 'gpt-5.5');
    expect(gpt55.length).toBe(1);
  });

  it('9. notifies listeners on change', () => {
    const listener = vi.fn();
    registry.subscribeToChanges(listener);
    registry.addDiscoveredModels([makeModel('new-model', 'test')]);
    expect(listener).toHaveBeenCalled();
  });

  it('10. unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsub = registry.subscribeToChanges(listener);
    unsub();
    registry.addDiscoveredModels([makeModel('new-model', 'test')]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('11. getAllModels returns models for all providers', () => {
    const all = registry.getAllModels();
    expect(all.length).toBeGreaterThan(100);
  });

  it('12. getStats returns correct counts', () => {
    registry.addDiscoveredModels([makeModel('d1', 'test')]);
    registry.addCustomModel(makeModel('c1', 'test'));
    const stats = registry.getStats();
    expect(stats.bundled).toBeGreaterThan(0);
    expect(stats.discovered).toBe(1);
    expect(stats.custom).toBe(1);
  });

  it('13. getModelAuthorityStats splits live discovery from bundled fallback per provider', () => {
    registry.addDiscoveredModels([
      makeModel('live-a', 'authority-provider'),
      makeModel('live-b', 'authority-provider'),
    ]);
    const withLive = registry.getModelAuthorityStats('authority-provider');
    expect(withLive.liveDiscoveryCount).toBe(2);
    expect(withLive.bundledFallbackCount).toBe(0);
    expect(withLive.customCount).toBe(0);

    const bundledOnly = registry.getModelAuthorityStats('openai');
    expect(bundledOnly.liveDiscoveryCount).toBe(0);
    expect(bundledOnly.bundledFallbackCount).toBeGreaterThan(0);
  });

  it('14. reports NOT_ATTEMPTED discovery state until an attempt actually runs', () => {
    expect(registry.hasDiscoveryCapability('openai')).toBe(true);
    expect(registry.getModelAuthorityStats('openai').discoveryState).toBe(
      'NOT_ATTEMPTED',
    );
  });

  it('15. attemptAuthoritativeDiscovery records UNSUPPORTED for a provider without a discovery adapter', async () => {
    const attempt = await registry.attemptAuthoritativeDiscovery(
      'no-such-provider-xyz',
    );
    expect(attempt.state).toBe('UNSUPPORTED');
    expect(attempt.models).toEqual([]);
    expect(
      registry.getModelAuthorityStats('no-such-provider-xyz').discoveryState,
    ).toBe('UNSUPPORTED');
  });

  it('16. Copilot/live authority regression: selects deterministic live candidate, never stale bundled/configured fallback', () => {
    // Bundled fallback for github-copilot has gpt-5.5 (X).
    // Live discovery returns [A, B, C].
    registry.addDiscoveredModels([
      makeModel('claude-sonnet-4-6', 'github-copilot'),
      makeModel('claude-opus-4-8', 'github-copilot'),
      makeModel('gpt-4o', 'github-copilot'),
    ]);

    // Stale configured model is X ('gpt-5.5'), which is not in live discovery.
    const selection = registry.resolveModelSelection({
      providerId: 'github-copilot',
      configuredModel: 'gpt-5.5',
    });

    expect(selection.model?.id).toBe('claude-sonnet-4-6');
    expect(selection.source).toBe('LIVE_AUTHORITY_FIRST');
    expect(selection.liveAuthorityMatch).toBe(true);
    expect(selection.model?.id).not.toBe('gpt-5.5');
  });

  it('17. Live authority preserves configured model if confirmed present in live discovery', () => {
    registry.addDiscoveredModels([
      makeModel('claude-sonnet-4-6', 'github-copilot'),
      makeModel('claude-opus-4-8', 'github-copilot'),
      makeModel('gpt-4o', 'github-copilot'),
    ]);

    const selection = registry.resolveModelSelection({
      providerId: 'github-copilot',
      configuredModel: 'claude-opus-4-8',
    });

    expect(selection.model?.id).toBe('claude-opus-4-8');
    expect(selection.source).toBe('CONFIGURED_PREFERENCE');
    expect(selection.liveAuthorityMatch).toBe(true);
  });

  it('18. Live authority preserves wireModelId mapping when display and wire IDs differ', () => {
    registry.addDiscoveredModels([
      makeModel('claude-opus-4-8-1m', 'github-copilot', {
        requestModelId: 'claude-opus-4-8',
      }),
    ]);

    const selection = registry.resolveModelSelection({
      providerId: 'github-copilot',
    });

    expect(selection.model?.id).toBe('claude-opus-4-8-1m');
    expect(selection.displayId).toBe('claude-opus-4-8-1m');
    expect(selection.wireId).toBe('claude-opus-4-8');
    expect(selection.liveAuthorityMatch).toBe(true);
  });

  it('19. composeModel preserves bundled toolsSupported and compat flags when discovery omits them', () => {
    const bundled = makeModel('test-model', 'test-prov', {
      toolsSupported: true,
      toolsCapabilitySource: 'BUNDLED_CATALOG',
      openaiCompat: { strictTools: true },
      thinking: { mode: 'effort' },
    });
    const sparseDiscovered = makeModel('test-model', 'test-prov', {
      contextWindow: 131072,
      maxTokens: 32768,
      toolsSupported: undefined,
      toolsCapabilitySource: undefined,
    });
    const composed = composeModel(sparseDiscovered, bundled);
    expect(composed.toolsSupported).toBe(true);
    expect(composed.toolsCapabilitySource).toBe('BUNDLED_CATALOG');
    expect(composed.openaiCompat?.strictTools).toBe(true);
    expect(composed.thinking?.mode).toBe('effort');
  });

  it('20. OpenCode Go and OpenCode Zen retain toolsSupported: true through model resolution', () => {
    const opencodeGo = registry.findModel('opencode-go', 'kimi-k2.7-code');
    expect(opencodeGo).toBeDefined();
    expect(opencodeGo?.toolsSupported).toBe(true);
    expect(opencodeGo?.toolsCapabilitySource).toBe('BUNDLED_CATALOG');

    const opencodeZen = registry.findModel('opencode-zen', 'claude-opus-4-8');
    expect(opencodeZen).toBeDefined();
    expect(opencodeZen?.toolsSupported).toBe(true);
    expect(opencodeZen?.toolsCapabilitySource).toBe('BUNDLED_CATALOG');
  });

  it('21. Route-scoped model selection filters candidates against targetDialect and targetEndpointFamily', () => {
    // Model A is openai-responses, Model B is openai-completions
    registry.addDiscoveredModels([
      makeModel('model-completions', 'test-route-prov', {
        api: 'openai-completions',
      }),
      makeModel('model-responses', 'test-route-prov', {
        api: 'openai-responses',
      }),
    ]);

    // Request target dialect openai-responses
    const selection = registry.resolveModelSelection({
      providerId: 'test-route-prov',
      targetDialect: 'openai-responses',
    });

    expect(selection.model?.id).toBe('model-responses');
    expect(selection.routeAuthority).toBe('MATCH');
    expect(selection.routeMismatchReason).toBe('NONE');
  });

  it('22. User explicit model with route mismatch reports USER_EXPLICIT with routeAuthority: MISMATCH', () => {
    registry.addDiscoveredModels([
      makeModel('model-completions', 'test-route-prov', {
        api: 'openai-completions',
      }),
    ]);

    const selection = registry.resolveModelSelection({
      providerId: 'test-route-prov',
      requestedModel: 'model-completions',
      targetDialect: 'openai-responses',
    });

    expect(selection.model?.id).toBe('model-completions');
    expect(selection.source).toBe('USER_EXPLICIT');
    expect(selection.providerAuthorityMatch).toBe(true);
    expect(selection.routeAuthority).toBe('MISMATCH');
    expect(selection.routeMismatchReason).toBe('DIALECT_MISMATCH');
  });

  it('23. Provider membership alone (no target constraints) never fabricates MATCH — reports UNKNOWN', () => {
    registry.addDiscoveredModels([
      makeModel('gpt-5.5', 'test-route-prov', { api: 'openai-responses' }),
    ]);

    const selection = registry.resolveModelSelection({
      providerId: 'test-route-prov',
    });

    expect(selection.model?.id).toBe('gpt-5.5');
    expect(selection.routeAuthority).toBe('UNKNOWN');
    expect(selection.routeAuthoritySource).toBe('NO_TARGET_CONSTRAINTS');
    expect(selection.fallbackReason).toBe('PROBE_ROUTE_UNVERIFIED');
  });

  it('24. Missing route metadata (no target given) is UNKNOWN even for an explicit --model', () => {
    registry.addDiscoveredModels([
      makeModel('gpt-5.5', 'test-route-prov', { api: 'openai-responses' }),
    ]);

    const selection = registry.resolveModelSelection({
      providerId: 'test-route-prov',
      requestedModel: 'gpt-5.5',
    });

    expect(selection.source).toBe('USER_EXPLICIT');
    expect(selection.routeAuthority).toBe('UNKNOWN');
  });

  it('25. Automatic selection prefers a MATCH candidate over an UNKNOWN one', () => {
    registry.addDiscoveredModels([
      makeModel('model-a', 'test-route-prov', { api: 'openai-completions' }),
      makeModel('model-b', 'test-route-prov', { api: 'openai-responses' }),
    ]);

    const selection = registry.resolveModelSelection({
      providerId: 'test-route-prov',
      targetDialect: 'openai-responses',
    });

    expect(selection.model?.id).toBe('model-b');
    expect(selection.routeAuthority).toBe('MATCH');
  });

  it('26. Automatic selection never selects a proven MISMATCH candidate', () => {
    registry.addDiscoveredModels([
      makeModel('model-a', 'test-route-prov', { api: 'openai-completions' }),
    ]);

    const selection = registry.resolveModelSelection({
      providerId: 'test-route-prov',
      targetDialect: 'anthropic-messages',
    });

    expect(selection.model).toBeUndefined();
    expect(selection.routeAuthority).toBe('MISMATCH');
    expect(selection.fallbackReason).toBe('ROUTE_MODEL_UNRESOLVED');
  });
});

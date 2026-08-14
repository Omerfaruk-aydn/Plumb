/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  output,
  initialize,
  getApiKey,
  getActiveProviderStates,
  authorityStats,
  hasDiscoveryCapability,
  attemptAuthoritativeDiscovery,
  loadCache,
  model,
} = vi.hoisted(() => ({
  output: [] as string[],
  initialize: vi.fn(async () => undefined),
  getApiKey: vi.fn(async () => 'must-not-be-read'),
  getActiveProviderStates: vi.fn(() => [
    { provider: { id: 'z-provider' }, authState: 'authenticated' },
    { provider: { id: 'a-provider' }, authState: 'authenticated' },
  ]),
  authorityStats: vi.fn((_providerId: string) => ({
    liveDiscoveryCount: 2,
    bundledFallbackCount: 1,
    customCount: 0,
    discoveryState: 'SUCCEEDED_NONEMPTY',
  })),
  hasDiscoveryCapability: vi.fn(() => true),
  attemptAuthoritativeDiscovery: vi.fn(async () => ({
    models: [],
    state: 'SUCCEEDED_NONEMPTY',
  })),
  loadCache: vi.fn(() => []),
  model: {
    id: 'safe-model',
    name: 'Safe model',
    provider: 'safe-provider',
    api: 'openai-completions',
    baseUrl: 'https://secret-host.example/v1',
    contextWindow: 1000,
    maxTokens: 100,
    input: 'text',
  },
}));

vi.mock('@plumb/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plumb/provider')>();
  return {
    // Keep the honest classification helpers (classifyBatchResult,
    // computeBatchBreakdown, resolveLiveModelAuthority) REAL so the batch
    // wiring is tested against the true contract, never a mock of it.
    ...actual,
    buildEffectiveToolRouteContract: vi.fn(() => ({
      scope: {
        providerId: 'safe-provider',
        modelId: 'safe-model',
        wireModelId: 'wire-model',
        dialect: 'openai-completions',
        endpoint: {
          baseUrl: 'https://secret-host.example/v1',
          path: '/chat/completions',
          family: 'OPENAI_CHAT_COMPLETIONS',
          source: 'MODEL',
        },
        cacheKey: 'must-not-print-cache-key',
      },
      baseModelTools: { status: 'SUPPORTED', source: 'OMP_CATALOG' },
      structuredProtocol: {
        kind: 'OPENAI_CHAT_FUNCTION_TOOLS',
        capability: { status: 'SUPPORTED', source: 'DIALECT_IMPLEMENTATION' },
      },
      toolChoice: {
        emission: 'omit',
        auto: { status: 'UNKNOWN', source: 'UNKNOWN' },
        required: { status: 'SUPPORTED', source: 'OMP_COMPAT' },
        named: { status: 'SUPPORTED', source: 'OMP_COMPAT' },
      },
      strictToolSchema: { status: 'UNKNOWN', source: 'UNKNOWN' },
      parallelToolCalls: { status: 'SUPPORTED', source: 'OMP_COMPAT' },
      reasoningWithTools: { status: 'UNKNOWN', source: 'UNKNOWN' },
      parser: {
        capability: { status: 'SUPPORTED', source: 'DIALECT_IMPLEMENTATION' },
        output: 'NORMALIZED_TOOL_CALL_EVENT',
        fragmentAssembly: {
          status: 'SUPPORTED',
          source: 'DIALECT_IMPLEMENTATION',
        },
        callIdPreservation: {
          status: 'SUPPORTED',
          source: 'DIALECT_IMPLEMENTATION',
        },
      },
      replay: {
        capability: { status: 'SUPPORTED', source: 'DIALECT_IMPLEMENTATION' },
        assistantToolCalls: {
          status: 'SUPPORTED',
          source: 'DIALECT_IMPLEMENTATION',
        },
        toolResults: { status: 'SUPPORTED', source: 'DIALECT_IMPLEMENTATION' },
      },
    })),
    getPlumbProviderProtocolMatrix: vi.fn(() => ({
      counts: {
        registeredProviders: 70,
        selectableProviders: 60,
        providerRows: 70,
        modelRoutes: 1200,
      },
      providers: [
        {
          providerId: 'safe-provider',
          selectable: true,
          modelRouteCount: 3,
          baseModelTools: { supported: 1, unsupported: 1, unknown: 1 },
        },
      ],
    })),
    getPlumbProvider: vi.fn((id: string) =>
      id === 'safe-provider' ? { id } : undefined,
    ),
    getPlumbProviderRegistry: vi.fn(() => ({
      initialize,
      getApiKey,
      getProviderState: vi.fn(() => undefined),
      getActiveProviderStates,
    })),
    getLastToolRouteDiag: vi.fn(() => ({
      requestToolsCount: 1,
      toolChoiceSent: true,
    })),
    getPlumbModelRegistry: vi.fn(() => ({
      findModel: vi.fn(() => model),
      resolveDefaultModel: vi.fn(() => model),
      resolveModelSelection: vi.fn(
        (input: { requestedModel?: string; configuredModel?: string }) => ({
          model,
          source: input.requestedModel
            ? 'USER_EXPLICIT'
            : 'LIVE_AUTHORITY_FIRST',
          displayId: model.id,
          wireId: 'wire-model',
          liveAuthorityMatch: true,
          fallbackReason: 'none',
        }),
      ),
      getDefaultModel: vi.fn(() => null),
      refreshProvider: vi.fn(() => {
        throw new Error('diagnosis must not discover models');
      }),
      getModelAuthorityStats: authorityStats,
      hasDiscoveryCapability,
      attemptAuthoritativeDiscovery,
      loadCache,
    })),
    plumbModelStream: vi.fn(),
    enableToolRouteDiag: vi.fn(),
    resolveEffectiveToolChoice: vi.fn(),
    resolveRouteToolPolicy: vi.fn(),
    deriveDialectToolChoiceCapability: vi.fn(),
    deriveRouteToolChoiceCapability: vi.fn(),
    resolveHonestProbeToolChoice: vi.fn(),
  };
});

vi.mock('@plumb/core', () => ({
  writeToStdout: vi.fn((value: string) => output.push(value)),
  Config: class {},
  CANONICAL_NO_ARGS_SCHEMA: {},
  MessageBus: class {},
  PlumbToolProbe: class {},
  PLUMB_TOOL_PROBE_NAME: 'plumb_tool_probe',
  PLUMB_TOOL_PROBE_RESULT: 'ok',
  PolicyDecision: { ALLOW: 'allow' },
  Scheduler: class {},
  ToolRegistry: class {},
}));

import {
  computeProbeForce,
  diagnoseToolRoute,
  isCompletedToolContinuationEvent,
  runConfiguredToolRouteProbes,
  runToolRouteProbeResult,
  toolChoiceSentSource,
  type ToolRouteProbeOutcome,
} from './toolRouteProbe.js';

function rendered(): string {
  return output.join('');
}

describe('tool route diagnostics', () => {
  beforeEach(() => {
    output.length = 0;
    initialize.mockClear();
    getApiKey.mockClear();
    getActiveProviderStates.mockClear();
    authorityStats.mockClear();
    authorityStats.mockImplementation(() => ({
      liveDiscoveryCount: 2,
      bundledFallbackCount: 1,
      customCount: 0,
      discoveryState: 'SUCCEEDED_NONEMPTY',
    }));
    hasDiscoveryCapability.mockClear();
    hasDiscoveryCapability.mockReturnValue(true);
    attemptAuthoritativeDiscovery.mockClear();
    attemptAuthoritativeDiscovery.mockResolvedValue({
      models: [],
      state: 'SUCCEEDED_NONEMPTY',
    });
  });

  it('prints the safe auto-route contract and exact matrix counters', async () => {
    await expect(
      diagnoseToolRoute('safe-provider', 'safe-model'),
    ).resolves.toBe(0);

    const text = rendered();
    expect(text).toContain('diagnostic.mode: AUTO_ROUTE_CONTRACT');
    expect(text).toContain('model.selection.source: USER_EXPLICIT');
    expect(text).toContain('model.selection.displayId: safe-model');
    expect(text).toContain('model.selection.wireId: wire-model');
    expect(text).toContain('model.selection.liveAuthorityMatch: true');
    expect(text).toContain('toolChoice.auto.status: UNKNOWN');
    expect(text).toContain(
      'AUTO_TOOL_SELECTION_WORKS: UNKNOWN_NOT_LIVE_TESTED',
    );
    expect(text).toContain(
      'FORCED_STRUCTURED_TOOL_PROTOCOL_WORKS: NOT_TESTED_BY_DIAGNOSIS',
    );
    expect(text).toContain('matrix.registeredProviders: 70');
    expect(text).toContain('matrix.provider.baseModelTools.supported: 1');
    expect(text).toContain('endpoint.baseUrl.present: true');
    expect(text).not.toContain('https://secret-host.example');
    expect(text).not.toContain('must-not-print-cache-key');
    expect(text).not.toMatch(/prompt|arguments|api.?key|token/i);
    expect(getApiKey).not.toHaveBeenCalled();
  });

  it('requires a provider for route diagnosis', async () => {
    await expect(diagnoseToolRoute(undefined, 'safe-model')).resolves.toBe(1);
    expect(rendered()).toContain('result: PROVIDER_REQUIRED');
  });

  it('does not accept a bare done event as a completed continuation', () => {
    expect(
      isCompletedToolContinuationEvent({ type: 'done', text: undefined }),
    ).toBe(false);
  });

  it('accepts only non-empty continuation text', () => {
    expect(
      isCompletedToolContinuationEvent({ type: 'text', text: 'continued' }),
    ).toBe(true);
    expect(
      isCompletedToolContinuationEvent({ type: 'text', text: '   ' }),
    ).toBe(false);
  });

  it('runs configured providers sequentially and reports honest mutually-exclusive counters', async () => {
    const order: string[] = [];
    const probe = vi.fn(
      async (providerId: string): Promise<ToolRouteProbeOutcome> => {
        order.push(providerId);
        return providerId === 'a-provider'
          ? {
              provider: providerId,
              exitCode: 0,
              code: 'OK',
              structuredToolCalls: true,
            }
          : {
              provider: providerId,
              exitCode: 1,
              code: 'AUTH_REQUIRED',
              structuredToolCalls: false,
            };
      },
    );

    await expect(runConfiguredToolRouteProbes(probe)).resolves.toBe(1);

    expect(order).toEqual(['a-provider', 'z-provider']);
    const text = rendered();
    expect(text).toContain('batch.configured.count: 2');
    expect(text).toContain('batch.pass.count: 1');
    expect(text).toContain('batch.authBlocked.count: 1');
    expect(text).toContain('batch.requestFailed.count: 0');
    expect(text).toContain('batch.modelUnavailable.count: 0');
    expect(text).toContain('batch.liveModelUnresolved.count: 0');
    expect(text).toContain('BATCH_SUM: 2');
    expect(text).toContain('BATCH_SUM_MATCHES_CONFIGURED: true');
    // Zero request failures + some passes + one environment blocker:
    // inconclusive, never CONFIGURED_ROUTE_FAILURES.
    expect(text).toContain('result: CONFIGURED_ROUTE_PROBES_INCONCLUSIVE');
    expect(text).not.toContain('CONFIGURED_ROUTE_FAILURES');
    // The old passed/failed lumping must be gone.
    expect(text).not.toContain('batch.passed.count');
    expect(text).not.toContain('batch.failed.count');
  });

  it('classifies AUTH_REQUIRED as authBlocked, never requestFailed, and reports environment blocked', async () => {
    getActiveProviderStates.mockReturnValue([
      { provider: { id: 'authy' }, authState: 'authenticated' },
    ]);
    const probe = vi.fn(
      async (providerId: string): Promise<ToolRouteProbeOutcome> => ({
        provider: providerId,
        exitCode: 1,
        code: 'AUTH_REQUIRED',
        structuredToolCalls: false,
      }),
    );

    await expect(runConfiguredToolRouteProbes(probe)).resolves.toBe(1);

    const text = rendered();
    expect(text).toContain('batch.authBlocked.count: 1');
    expect(text).toContain('batch.requestFailed.count: 0');
    expect(text).toContain('batch.provider.class: AUTH_BLOCKED');
    expect(text).toContain('BATCH_SUM: 1');
    expect(text).toContain('result: CONFIGURED_ROUTE_ENVIRONMENT_BLOCKED');
  });

  it('classifies MODEL_NOT_AVAILABLE as modelUnavailable', async () => {
    getActiveProviderStates.mockReturnValue([
      { provider: { id: 'nvidia' }, authState: 'authenticated' },
    ]);
    const probe = vi.fn(
      async (providerId: string): Promise<ToolRouteProbeOutcome> => ({
        provider: providerId,
        exitCode: 1,
        code: 'MODEL_NOT_AVAILABLE',
        structuredToolCalls: false,
      }),
    );

    await expect(runConfiguredToolRouteProbes(probe)).resolves.toBe(1);

    const text = rendered();
    expect(text).toContain('batch.modelUnavailable.count: 1');
    expect(text).toContain('batch.requestFailed.count: 0');
    expect(text).toContain('batch.provider.class: MODEL_UNAVAILABLE');
    expect(text).toContain('result: CONFIGURED_ROUTE_ENVIRONMENT_BLOCKED');
  });

  it('classifies NETWORK_ERROR on a local server as serverUnavailable, not a tool failure', async () => {
    getActiveProviderStates.mockReturnValue([
      { provider: { id: 'ollama' }, authState: 'authenticated' },
    ]);
    const probe = vi.fn(
      async (providerId: string): Promise<ToolRouteProbeOutcome> => ({
        provider: providerId,
        exitCode: 1,
        code: 'NETWORK_ERROR',
        structuredToolCalls: false,
      }),
    );

    await expect(runConfiguredToolRouteProbes(probe)).resolves.toBe(1);

    const text = rendered();
    expect(text).toContain('batch.serverUnavailable.count: 1');
    expect(text).toContain('batch.requestFailed.count: 0');
    expect(text).toContain('batch.provider.class: SERVER_UNAVAILABLE');
    expect(text).toContain('result: CONFIGURED_ROUTE_ENVIRONMENT_BLOCKED');
  });
});

describe('batch discovery-state-driven authority', () => {
  beforeEach(() => {
    output.length = 0;
    initialize.mockClear();
    getApiKey.mockClear();
    getActiveProviderStates.mockClear();
    authorityStats.mockClear();
    authorityStats.mockImplementation(() => ({
      liveDiscoveryCount: 2,
      bundledFallbackCount: 1,
      customCount: 0,
      discoveryState: 'SUCCEEDED_NONEMPTY',
    }));
    hasDiscoveryCapability.mockClear();
    hasDiscoveryCapability.mockReturnValue(true);
    attemptAuthoritativeDiscovery.mockClear();
    attemptAuthoritativeDiscovery.mockResolvedValue({
      models: [],
      state: 'SUCCEEDED_NONEMPTY',
    });
  });

  it('SUCCEEDED_EMPTY discovery is the ONLY LIVE_MODEL_UNRESOLVED justification and skips the probe', async () => {
    output.length = 0;
    getActiveProviderStates.mockReturnValue([
      { provider: { id: 'empty-live' }, authState: 'authenticated' },
      { provider: { id: 'live' }, authState: 'authenticated' },
    ]);
    authorityStats.mockImplementation((providerId: string) =>
      providerId === 'empty-live'
        ? {
            liveDiscoveryCount: 0,
            bundledFallbackCount: 161,
            customCount: 0,
            discoveryState: 'SUCCEEDED_EMPTY',
          }
        : {
            liveDiscoveryCount: 3,
            bundledFallbackCount: 2,
            customCount: 0,
            discoveryState: 'SUCCEEDED_NONEMPTY',
          },
    );
    const probe = vi.fn(
      async (providerId: string): Promise<ToolRouteProbeOutcome> => ({
        provider: providerId,
        exitCode: 0,
        code: 'OK',
        structuredToolCalls: false,
      }),
    );

    await expect(runConfiguredToolRouteProbes(probe)).resolves.toBe(1);

    // Discovery is attempted for the provider, but the probe request is not.
    expect(attemptAuthoritativeDiscovery).toHaveBeenCalledWith(
      'empty-live',
      expect.anything(),
    );
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith('live', undefined);
    const text = rendered();
    expect(text).toContain('batch.provider.discoveryState: SUCCEEDED_EMPTY');
    expect(text).toContain('batch.provider.modelAuthority: LIVE_FALLBACK');
    expect(text).toContain('batch.provider.result: LIVE_MODEL_UNRESOLVED');
    expect(text).toContain('batch.liveModelUnresolved.count: 1');
    expect(text).toContain('BATCH_SUM: 2');
    expect(text).toContain('BATCH_SUM_MATCHES_CONFIGURED: true');
  });

  it('NOT_ATTEMPTED with a bundled catalog keeps STATIC_AUTHORITATIVE authority (probe runs, never LIVE_MODEL_UNRESOLVED)', async () => {
    output.length = 0;
    getActiveProviderStates.mockReturnValue([
      { provider: { id: 'static-provider' }, authState: 'authenticated' },
    ]);
    hasDiscoveryCapability.mockReturnValue(false);
    authorityStats.mockReturnValue({
      liveDiscoveryCount: 0,
      bundledFallbackCount: 5,
      customCount: 0,
      discoveryState: 'NOT_ATTEMPTED',
    });
    const probe = vi.fn(
      async (providerId: string): Promise<ToolRouteProbeOutcome> => ({
        provider: providerId,
        exitCode: 0,
        code: 'OK',
        structuredToolCalls: true,
      }),
    );

    await expect(runConfiguredToolRouteProbes(probe)).resolves.toBe(0);

    expect(attemptAuthoritativeDiscovery).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledWith('static-provider', undefined);
    const text = rendered();
    expect(text).toContain(
      'batch.provider.modelAuthority: STATIC_AUTHORITATIVE',
    );
    expect(text).toContain('batch.liveModelUnresolved.count: 0');
    expect(text).toContain('result: CONFIGURED_ROUTE_PROBES_PASS');
  });

  it('local discovery SERVER_UNAVAILABLE blocks the probe as an environment blocker', async () => {
    output.length = 0;
    getActiveProviderStates.mockReturnValue([
      { provider: { id: 'ollama' }, authState: 'authenticated' },
    ]);
    authorityStats.mockReturnValue({
      liveDiscoveryCount: 0,
      bundledFallbackCount: 0,
      customCount: 0,
      discoveryState: 'SERVER_UNAVAILABLE',
    });
    const probe = vi.fn(
      async (providerId: string): Promise<ToolRouteProbeOutcome> => ({
        provider: providerId,
        exitCode: 0,
        code: 'OK',
        structuredToolCalls: true,
      }),
    );

    await expect(runConfiguredToolRouteProbes(probe)).resolves.toBe(1);

    expect(probe).not.toHaveBeenCalled();
    const text = rendered();
    expect(text).toContain('batch.serverUnavailable.count: 1');
    expect(text).toContain('batch.liveModelUnresolved.count: 0');
    expect(text).toContain('result: CONFIGURED_ROUTE_ENVIRONMENT_BLOCKED');
  });
});

describe('batch final-result policy (Problem 8)', () => {
  beforeEach(() => {
    output.length = 0;
    initialize.mockClear();
    getApiKey.mockClear();
    getActiveProviderStates.mockClear();
    authorityStats.mockClear();
    authorityStats.mockImplementation(() => ({
      liveDiscoveryCount: 2,
      bundledFallbackCount: 1,
      customCount: 0,
      discoveryState: 'SUCCEEDED_NONEMPTY',
    }));
    hasDiscoveryCapability.mockClear();
    hasDiscoveryCapability.mockReturnValue(true);
    attemptAuthoritativeDiscovery.mockClear();
    attemptAuthoritativeDiscovery.mockResolvedValue({
      models: [],
      state: 'SUCCEEDED_NONEMPTY',
    });
  });

  it('all-inconclusive batches are NEVER reported as CONFIGURED_ROUTE_FAILURES', async () => {
    output.length = 0;
    getActiveProviderStates.mockReturnValue([
      { provider: { id: 'auth-blocked' }, authState: 'authenticated' },
      { provider: { id: 'empty-live' }, authState: 'authenticated' },
    ]);
    authorityStats.mockImplementation((providerId: string) =>
      providerId === 'auth-blocked'
        ? {
            liveDiscoveryCount: 0,
            bundledFallbackCount: 3,
            customCount: 0,
            discoveryState: 'AUTH_BLOCKED',
          }
        : {
            liveDiscoveryCount: 0,
            bundledFallbackCount: 161,
            customCount: 0,
            discoveryState: 'SUCCEEDED_EMPTY',
          },
    );
    const probe = vi.fn();

    await expect(runConfiguredToolRouteProbes(probe)).resolves.toBe(1);

    const text = rendered();
    expect(probe).not.toHaveBeenCalled();
    expect(text).toContain('batch.requestFailed.count: 0');
    expect(text).toContain('batch.authBlocked.count: 1');
    expect(text).toContain('batch.liveModelUnresolved.count: 1');
    expect(text).toContain('result: CONFIGURED_ROUTE_ENVIRONMENT_BLOCKED');
    expect(text).not.toContain('CONFIGURED_ROUTE_FAILURES');
  });

  it('allows an explicit --model on a bundled-fallback-only provider (USER_EXPLICIT, no discovery)', async () => {
    output.length = 0;
    getActiveProviderStates.mockReturnValue([
      { provider: { id: 'bundled-only' }, authState: 'authenticated' },
    ]);
    authorityStats.mockReturnValue({
      liveDiscoveryCount: 0,
      bundledFallbackCount: 161,
      customCount: 0,
      discoveryState: 'NOT_ATTEMPTED',
    });
    const probe = vi.fn(
      async (
        providerId: string,
        _requestedModel?: string,
      ): Promise<ToolRouteProbeOutcome> => ({
        provider: providerId,
        exitCode: 1,
        code: 'MODEL_NOT_AVAILABLE',
        structuredToolCalls: false,
      }),
    );

    await expect(
      runConfiguredToolRouteProbes(probe, { explicitModel: 'gpt-5.5' }),
    ).resolves.toBe(1);

    expect(attemptAuthoritativeDiscovery).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledWith('bundled-only', 'gpt-5.5');
    const text = rendered();
    expect(text).toContain('batch.provider.modelAuthority: USER_EXPLICIT');
    expect(text).toContain('batch.modelUnavailable.count: 1');
    expect(text).toContain('batch.liveModelUnresolved.count: 0');
  });

  it('batch probe with LIVE_DISCOVERED authority calls probe without explicit model, allowing dynamic live candidate resolution', async () => {
    getActiveProviderStates.mockReturnValue([
      { provider: { id: 'github-copilot' }, authState: 'authenticated' },
    ]);
    authorityStats.mockReturnValue({
      liveDiscoveryCount: 77,
      bundledFallbackCount: 38,
      customCount: 0,
      discoveryState: 'SUCCEEDED_NONEMPTY',
    });

    const probe = vi.fn(
      async (
        providerId: string,
        _requestedModel?: string,
      ): Promise<ToolRouteProbeOutcome> => ({
        provider: providerId,
        exitCode: 0,
        code: 'OK',
        structuredToolCalls: true,
      }),
    );

    await expect(runConfiguredToolRouteProbes(probe)).resolves.toBe(0);

    expect(probe).toHaveBeenCalledWith('github-copilot', undefined);
    const text = rendered();
    expect(text).toContain('batch.provider.discoveryState: SUCCEEDED_NONEMPTY');
    expect(text).toContain('batch.provider.modelAuthority: LIVE_DISCOVERED');
    expect(text).toContain('batch.provider.liveDiscoveredModels: 77');
    expect(text).toContain('batch.pass.count: 1');
  });

  it('J. OpenCode Go live-shaped golden (full structured-tool chain) is preserved as PASS through the batch pipeline', async () => {
    getActiveProviderStates.mockReturnValue([
      { provider: { id: 'opencode-go' }, authState: 'authenticated' },
    ]);
    authorityStats.mockReturnValue({
      liveDiscoveryCount: 12,
      bundledFallbackCount: 4,
      customCount: 0,
      discoveryState: 'SUCCEEDED_NONEMPTY',
    });

    const probe = vi.fn(
      async (providerId: string): Promise<ToolRouteProbeOutcome> => ({
        provider: providerId,
        exitCode: 0,
        code: 'OK',
        structuredToolCalls: true,
        normalizedToolCalls: 1,
        schedulerExecutions: 1,
        toolResults: 1,
        resultReinjected: true,
        continuationCompleted: true,
        forceRequested: true,
        forceEffective: true,
      }),
    );

    await expect(runConfiguredToolRouteProbes(probe)).resolves.toBe(0);

    const text = rendered();
    expect(text).toContain('batch.provider.class: PASS');
    expect(text).toContain('batch.pass.count: 1');
    expect(text).toContain('batch.inconclusive.count: 0');
    expect(text).toContain('result: CONFIGURED_ROUTE_PROBES_PASS');
  });
});

describe('toolChoiceSentSource (honest selector provenance)', () => {
  it('reports the honest auto fallback for an unverified route and never pretends to force', () => {
    expect(
      toolChoiceSentSource(
        { mode: 'auto' },
        { value: { mode: 'auto' }, sent: true, downgraded: false },
        false,
      ),
    ).toBe('HONEST_AUTO_FALLBACK_UNVERIFIED_ROUTE');
  });

  it('never fabricates named/required sources for an unverified Copilot route', () => {
    // Dialect supports forced+named, but the Copilot route is UNVERIFIED:
    // the honest probe requested auto, and the source must say so.
    const source = toolChoiceSentSource(
      { mode: 'auto' },
      { value: { mode: 'auto' }, sent: true, downgraded: false },
      false,
    );
    expect(source).toBe('HONEST_AUTO_FALLBACK_UNVERIFIED_ROUTE');
    expect(source).not.toMatch(/NAMED|REQUIRED/);
  });

  it('reports verified named/required sources for a proven route', () => {
    expect(
      toolChoiceSentSource(
        { mode: 'named', name: 'plumb_tool_probe' },
        {
          value: { mode: 'named', name: 'plumb_tool_probe' },
          sent: true,
          downgraded: false,
        },
        true,
      ),
    ).toBe('VERIFIED_ROUTE_NAMED');
    expect(
      toolChoiceSentSource(
        { mode: 'required' },
        { value: { mode: 'required' }, sent: true, downgraded: false },
        true,
      ),
    ).toBe('VERIFIED_ROUTE_REQUIRED');
  });

  it('reports absent selectors and policy-driven auto fallbacks', () => {
    expect(
      toolChoiceSentSource(
        undefined,
        { sent: false, downgraded: false },
        false,
      ),
    ).toBe('ABSENT');
    expect(
      toolChoiceSentSource(
        undefined,
        { value: { mode: 'auto' }, sent: true, downgraded: false },
        false,
      ),
    ).toBe('POLICY_AUTO_FALLBACK');
  });
});

describe('computeProbeForce (requested vs effective force, regression G)', () => {
  it('G. a downgraded selector reports forceRequested=true but forceEffective=false', () => {
    const result = computeProbeForce(
      { mode: 'named', name: 'plumb_tool_probe' },
      { value: { mode: 'auto' }, sent: true, downgraded: true },
    );
    expect(result.forceRequested).toBe(true);
    expect(result.forceEffective).toBe(false);
  });

  it('an undowngraded named/required selector reports both true', () => {
    expect(
      computeProbeForce(
        { mode: 'required' },
        { value: { mode: 'required' }, sent: true, downgraded: false },
      ),
    ).toEqual({ forceRequested: true, forceEffective: true });
  });

  it('an auto request never claims force in either direction', () => {
    expect(
      computeProbeForce(
        { mode: 'auto' },
        { value: { mode: 'auto' }, sent: true, downgraded: false },
      ),
    ).toEqual({ forceRequested: false, forceEffective: false });
  });
});

describe('single-probe pipeline unification (regression D)', () => {
  it('D. --test-tool-route without --model consults the same resolveProbeAuthorityDecision gate as the batch path, instead of flattening every failure to ROUTE_NOT_FOUND', async () => {
    authorityStats.mockImplementation(() => ({
      liveDiscoveryCount: 0,
      bundledFallbackCount: 1,
      customCount: 0,
      discoveryState: 'AUTH_BLOCKED',
    }));

    const outcome = await runToolRouteProbeResult('safe-provider');

    // The canonical authority decision is honored (AUTH_REQUIRED), not the
    // old single-probe behavior of collapsing everything into
    // ROUTE_NOT_FOUND whenever a model failed to resolve.
    expect(outcome.code).toBe('AUTH_REQUIRED');
    expect(outcome.exitCode).toBe(1);
    expect(rendered()).toContain('result: AUTH_REQUIRED');
    expect(rendered()).not.toContain('result: ROUTE_NOT_FOUND');
    expect(attemptAuthoritativeDiscovery).toHaveBeenCalled();
  });

  it('an explicit --model skips the discovery gate entirely (USER_EXPLICIT bypass), matching the batch explicit-model path', async () => {
    authorityStats.mockImplementation(() => ({
      liveDiscoveryCount: 0,
      bundledFallbackCount: 1,
      customCount: 0,
      discoveryState: 'AUTH_BLOCKED',
    }));
    attemptAuthoritativeDiscovery.mockClear();

    // With --model set, resolveToolRoute must not gate on discovery state at
    // all — it proceeds straight to resolveModelSelection (which the mock
    // resolves to `model`), so this never returns the AUTH_REQUIRED gate
    // code seen in the previous test.
    await runToolRouteProbeResult('safe-provider', 'safe-model').catch(
      () => undefined,
    );

    expect(attemptAuthoritativeDiscovery).not.toHaveBeenCalled();
  });

  it('C. cache hydration runs before resolution for an explicit --model, so a cached-only model is visible instead of flattening to ROUTE_NOT_FOUND', async () => {
    loadCache.mockClear();

    await runToolRouteProbeResult('safe-provider', 'claude-sonnet-4-6').catch(
      () => undefined,
    );

    // loadCache must run (synchronous, no-network) even though the
    // discovery/authority gate itself is skipped for an explicit model —
    // otherwise a model that only exists in the on-disk cache is invisible
    // to resolveModelSelection's findModel lookup.
    expect(loadCache).toHaveBeenCalledWith('safe-provider');
  });

  it('cache hydration also runs for the modeless path, so single and batch converge on the same hydrated authority before any live attempt', async () => {
    loadCache.mockClear();
    attemptAuthoritativeDiscovery.mockClear();

    await runToolRouteProbeResult('safe-provider').catch(() => undefined);

    const loadCacheCallOrder = loadCache.mock.invocationCallOrder[0];
    const discoveryCallOrder =
      attemptAuthoritativeDiscovery.mock.invocationCallOrder[0];
    expect(loadCache).toHaveBeenCalledWith('safe-provider');
    expect(attemptAuthoritativeDiscovery).toHaveBeenCalled();
    // Cache hydration is the first, cheap step — it must run before the
    // (potentially network-bound) authoritative discovery attempt.
    expect(loadCacheCallOrder).toBeLessThan(discoveryCallOrder);
  });
});

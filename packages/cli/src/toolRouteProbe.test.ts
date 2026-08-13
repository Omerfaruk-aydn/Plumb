/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { output, initialize, getApiKey, getActiveProviderStates, model } =
  vi.hoisted(() => ({
    output: [] as string[],
    initialize: vi.fn(async () => undefined),
    getApiKey: vi.fn(async () => 'must-not-be-read'),
    getActiveProviderStates: vi.fn(() => [
      { provider: { id: 'z-provider' }, authState: 'authenticated' },
      { provider: { id: 'a-provider' }, authState: 'authenticated' },
    ]),
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

vi.mock('@google/gemini-cli-provider', () => ({
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
    refreshProvider: vi.fn(() => {
      throw new Error('diagnosis must not discover models');
    }),
  })),
  plumbModelStream: vi.fn(),
  enableToolRouteDiag: vi.fn(),
  resolveEffectiveToolChoice: vi.fn(),
  resolveRouteToolPolicy: vi.fn(),
}));

vi.mock('@google/gemini-cli-core', () => ({
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
  diagnoseToolRoute,
  isCompletedToolContinuationEvent,
  runConfiguredToolRouteProbes,
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
  });

  it('prints the safe auto-route contract and exact matrix counters', async () => {
    await expect(
      diagnoseToolRoute('safe-provider', 'safe-model'),
    ).resolves.toBe(0);

    const text = rendered();
    expect(text).toContain('diagnostic.mode: AUTO_ROUTE_CONTRACT');
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

  it('runs configured providers sequentially and reports exact counters', async () => {
    const order: string[] = [];
    const probe = vi.fn(async (providerId: string) => {
      order.push(providerId);
      return providerId === 'a-provider' ? 0 : 1;
    });

    await expect(runConfiguredToolRouteProbes(probe)).resolves.toBe(1);

    expect(order).toEqual(['a-provider', 'z-provider']);
    expect(rendered()).toContain('batch.configured.count: 2');
    expect(rendered()).toContain('batch.passed.count: 1');
    expect(rendered()).toContain('batch.failed.count: 1');
    expect(rendered()).toContain('result: CONFIGURED_ROUTE_FAILURES');
  });
});

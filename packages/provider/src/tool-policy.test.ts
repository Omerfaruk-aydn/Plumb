/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { PlumbModel, PlumbRouteToolPolicy } from './types.js';
import {
  deriveDialectToolChoiceCapability,
  deriveRouteToolChoiceCapability,
  resolveEffectiveToolChoice,
  resolveHonestProbeToolChoice,
  resolveRouteToolPolicy,
} from './tool-policy.js';
import { getCatalogModel } from './catalog/model-catalog.js';

function route(overrides: Partial<PlumbModel> = {}): PlumbModel {
  return {
    id: 'route-model',
    provider: 'custom-openai-compat',
    api: 'openai-completions',
    contextWindow: 100_000,
    maxTokens: 4096,
    input: 'text',
    toolsSupported: true,
    ...overrides,
  };
}

describe('route-level tool protocol policy', () => {
  it.each([
    ['nvidia', 'deepseek-ai/deepseek-r1-0528', 'REQUIRED_WHEN_TOOLS_PRESENT'],
    ['deepseek', 'deepseek-v4-flash', 'FORBIDDEN'],
    ['opencode-zen', 'big-pickle', 'OPTIONAL'],
    ['opencode-go', 'deepseek-v4-flash', 'FORBIDDEN'],
    ['opencode-go', 'hy3', 'OPTIONAL'],
  ] as const)(
    'projects the exact OMP route policy for %s/%s',
    (provider, modelId, emission) => {
      const model = getCatalogModel(provider, modelId);
      expect(model).toBeDefined();
      expect(resolveRouteToolPolicy(model!).emission).toBe(emission);
    },
  );

  it('requires explicit auto for the NVIDIA NIM route when tools are present', () => {
    const policy = resolveRouteToolPolicy(
      route({
        provider: 'nvidia',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
      }),
    );
    expect(policy.emission).toBe('REQUIRED_WHEN_TOOLS_PRESENT');
    expect(resolveEffectiveToolChoice(policy, undefined, 1)).toEqual({
      value: { mode: 'auto' },
      sent: true,
      downgraded: false,
    });
  });

  it('honors OMP forbidden policy for a direct DeepSeek reasoning route', () => {
    const policy: PlumbRouteToolPolicy = {
      emission: 'FORBIDDEN',
      forcedToolChoiceSupported: false,
      namedToolChoiceSupported: false,
      source: 'OMP_COMPAT',
    };
    expect(
      resolveEffectiveToolChoice(
        resolveRouteToolPolicy(
          route({ provider: 'deepseek', toolPolicy: policy }),
        ),
        { mode: 'auto' },
        1,
      ),
    ).toEqual({ sent: false, downgraded: true });
  });

  it.each(['openai', 'openrouter', 'opencode-zen', 'opencode-go'])(
    '%s remains optional and omits an unrequested selector',
    (provider) => {
      const policy = resolveRouteToolPolicy(route({ provider }));
      expect(policy.emission).toBe('OPTIONAL');
      expect(resolveEffectiveToolChoice(policy, undefined, 1)).toEqual({
        value: undefined,
        sent: false,
        downgraded: false,
      });
    },
  );

  it('keeps forced and named support independent', () => {
    const policy: PlumbRouteToolPolicy = {
      emission: 'OPTIONAL',
      forcedToolChoiceSupported: true,
      namedToolChoiceSupported: false,
      source: 'OMP_COMPAT',
    };
    expect(
      resolveEffectiveToolChoice(policy, { mode: 'named', name: 'probe' }, 1),
    ).toEqual({
      value: { mode: 'required' },
      sent: true,
      downgraded: true,
    });
  });

  const forcedCapable: PlumbRouteToolPolicy = {
    emission: 'OPTIONAL',
    forcedToolChoiceSupported: true,
    namedToolChoiceSupported: true,
    source: 'DIALECT_DEFAULT',
  };

  it('never fabricates named/required for an unverified Copilot route', () => {
    const dialect = deriveDialectToolChoiceCapability(forcedCapable);
    const route = deriveRouteToolChoiceCapability('github-copilot', dialect);
    expect(route.providerProof).toBe('UNVERIFIED');
    expect(route.routeVerified).toBe(false);
    expect(route.required).toBe('UNKNOWN');
    expect(route.named).toBe('UNKNOWN');
    const choice = resolveHonestProbeToolChoice(
      route,
      forcedCapable.forcedToolChoiceSupported,
      forcedCapable.namedToolChoiceSupported,
    );
    // Dialect SUPPORTED must not leak into a forced selector on an
    // unverified route — the honest probe degrades to auto.
    expect(choice).toEqual({ mode: 'auto' });
  });

  it('keeps the verified named selector for the OpenCode Go golden route', () => {
    const dialect = deriveDialectToolChoiceCapability(forcedCapable);
    const route = deriveRouteToolChoiceCapability('opencode-go', dialect);
    expect(route.routeVerified).toBe(true);
    const choice = resolveHonestProbeToolChoice(
      route,
      forcedCapable.forcedToolChoiceSupported,
      forcedCapable.namedToolChoiceSupported,
    );
    expect(choice).toEqual({ mode: 'named', name: 'plumb_tool_probe' });
  });

  it('REGRESSION (OpenCode Go live golden): named VERIFIED + required NOT_SUPPORTED still emits named, never auto', () => {
    // OpenCode Go's real route: named = SUPPORTED, required = NOT_SUPPORTED.
    // The probe MUST use named(plumb_tool_probe) — it must not degrade to
    // auto merely because required is unavailable.
    const policy: PlumbRouteToolPolicy = {
      emission: 'OPTIONAL',
      forcedToolChoiceSupported: false,
      namedToolChoiceSupported: true,
      source: 'DIALECT_DEFAULT',
    };
    const dialect = deriveDialectToolChoiceCapability(policy);
    expect(dialect.required).toBe('NOT_SUPPORTED');
    expect(dialect.named).toBe('SUPPORTED');
    const route = deriveRouteToolChoiceCapability('opencode-go', dialect);
    expect(route.routeVerified).toBe(true);
    expect(route.named).toBe('SUPPORTED');
    expect(route.required).toBe('NOT_SUPPORTED');
    const choice = resolveHonestProbeToolChoice(
      route,
      policy.forcedToolChoiceSupported,
      policy.namedToolChoiceSupported,
    );
    expect(choice).toEqual({ mode: 'named', name: 'plumb_tool_probe' });
  });
});

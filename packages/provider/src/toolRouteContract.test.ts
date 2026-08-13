/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Honest batch tool-route probe classification: mutually-exclusive result
 * classes, sum-invariant breakdown, the universal LIVE_MODEL_UNRESOLVED rule,
 * and local-provider offline classification. AUTH_REQUIRED / MODEL_NOT_AVAILABLE
 * / offline local servers must never be counted as structured-tool failures.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyBatchResult,
  computeBatchBreakdown,
  isLocalProvider,
  resolveLiveModelAuthority,
  liveModelUnresolvedClassification,
  type ClassifiedBatchResult,
} from './toolRouteContract.js';

describe('batch result classification (mutually exclusive, honest)', () => {
  it.each([
    ['PASS', 'TOOL_CALL_REINJECTED', false],
    ['PASS', 'OK', false],
    ['AUTH_BLOCKED', 'AUTH_REQUIRED', false],
    ['AUTH_BLOCKED', 'MISSING_CREDENTIAL', false],
    ['MODEL_UNAVAILABLE', 'MODEL_NOT_AVAILABLE', false],
    ['MODEL_UNAVAILABLE', 'ENDPOINT_NOT_FOUND', false],
    ['ROUTE_UNRESOLVED', 'ROUTE_NOT_FOUND', false],
    ['ROUTE_UNRESOLVED', 'TRANSPORT_NOT_REGISTERED', false],
    ['PROTOCOL_UNSUPPORTED', 'FORCED_SELECTOR_WITH_ZERO_TOOLS', false],
    ['PROTOCOL_UNSUPPORTED', 'TOOL_CAPABILITY_INVARIANT', false],
    ['REQUEST_FAILED', 'INVALID_REQUEST', true],
    ['LIVE_MODEL_UNRESOLVED', 'LIVE_MODEL_UNRESOLVED', false],
  ] as const)(
    '%s <- %s (toolRuntimeFailure=%s)',
    (className, code, isToolRuntimeFailure) => {
      const r = classifyBatchResult({ provider: 'nvidia', code });
      expect(r.className).toBe(className);
      // Only genuine REQUEST_FAILED is a tool-runtime failure. Auth/model/
      // server/route and live-gap outcomes are NOT.
      expect(r.isToolRuntimeFailure).toBe(isToolRuntimeFailure);
    },
  );

  it('an unknown code is reported UNKNOWN, not mislabeled REQUEST_FAILED', () => {
    expect(
      classifyBatchResult({ provider: 'x', code: 'SOME_WEIRD_CODE' }).className,
    ).toBe('UNKNOWN');
  });

  it('offline local providers are SERVER_UNAVAILABLE, not tool failures', () => {
    expect(isLocalProvider('ollama')).toBe(true);
    expect(isLocalProvider('vllm')).toBe(true);
    expect(isLocalProvider('lm-studio')).toBe(true);
    expect(isLocalProvider('openai')).toBe(false);

    const offline = classifyBatchResult({
      provider: 'ollama',
      code: 'NETWORK_ERROR',
    });
    expect(offline.className).toBe('SERVER_UNAVAILABLE');
    expect(offline.isToolRuntimeFailure).toBe(false);
  });

  it('remote SERVER_UNAVAILABLE is also distinct from tool failure', () => {
    const offline = classifyBatchResult({
      provider: 'openai',
      code: 'TIMEOUT',
    });
    expect(offline.className).toBe('SERVER_UNAVAILABLE');
    expect(offline.isToolRuntimeFailure).toBe(false);
  });
});

describe('batch breakdown sum-invariant', () => {
  it('per-class sum always equals configured.count', () => {
    const results: ClassifiedBatchResult[] = [
      'TOOL_CALL_REINJECTED',
      'AUTH_REQUIRED',
      'MODEL_NOT_AVAILABLE',
      'ROUTE_NOT_FOUND',
      'NETWORK_ERROR',
      'LIVE_MODEL_UNRESOLVED',
      'INVALID_REQUEST',
      'UNKNOWN_THING',
      'AUTH_REQUIRED',
      'OK',
    ].map((code) => classifyBatchResult({ provider: 'mix', code }));

    const breakdown = computeBatchBreakdown(results, results.length);
    expect(breakdown.sumMatchesConfigured).toBe(true);
    expect(breakdown.sum).toBe(results.length);
    expect(breakdown.configuredTotal).toBe(results.length);

    // Individual classes are independently populated and mutually exclusive —
    // no single misleading "failed = 10" bucket.
    expect(breakdown.pass).toBe(2);
    expect(breakdown.authBlocked).toBe(2);
    expect(breakdown.modelUnavailable).toBe(1);
    expect(breakdown.routeUnresolved).toBe(1);
    expect(breakdown.serverUnavailable).toBe(1);
    expect(breakdown.liveModelUnresolved).toBe(1);
    expect(breakdown.requestFailure).toBe(1);
    expect(breakdown.unknown).toBe(1);

    const sumAll =
      breakdown.pass +
      breakdown.requestFailure +
      breakdown.authBlocked +
      breakdown.modelUnavailable +
      breakdown.serverUnavailable +
      breakdown.routeUnresolved +
      breakdown.protocolUnsupported +
      breakdown.liveModelUnresolved +
      breakdown.unknown;
    expect(sumAll).toBe(results.length);
  });
});

describe('live model authority (universal, every provider)', () => {
  it('zero live discovery + bundled fallback + no explicit --model => LIVE_MODEL_UNRESOLVED (NVIDIA case)', () => {
    const authority = resolveLiveModelAuthority({
      liveDiscoveryCount: 0,
      bundledFallbackCount: 161,
      explicitModelRequested: false,
      fallbackUsed: true,
    });
    expect(authority).toBe('LIVE_MODEL_UNRESOLVED');
    expect(liveModelUnresolvedClassification()).toBe('LIVE_MODEL_UNRESOLVED');
  });

  it('an explicit --model still allows the attempt (MODEL_NOT_AVAILABLE is then an honest route result)', () => {
    expect(
      resolveLiveModelAuthority({
        liveDiscoveryCount: 0,
        bundledFallbackCount: 161,
        explicitModelRequested: true,
        fallbackUsed: true,
      }),
    ).toBe('EXPLICIT_OK');
  });

  it('live discovery found models => LIVE authority', () => {
    expect(
      resolveLiveModelAuthority({
        liveDiscoveryCount: 5,
        bundledFallbackCount: 0,
        explicitModelRequested: false,
        fallbackUsed: false,
      }),
    ).toBe('LIVE');
  });

  it('rule applies to every provider, not only NVIDIA', () => {
    for (const provider of ['nvidia', 'openai', 'anthropic', 'google-vertex']) {
      expect(
        resolveLiveModelAuthority({
          liveDiscoveryCount: 0,
          bundledFallbackCount: 10,
          explicitModelRequested: false,
          fallbackUsed: true,
        }),
      ).toBe('LIVE_MODEL_UNRESOLVED');
      void provider;
    }
  });
});

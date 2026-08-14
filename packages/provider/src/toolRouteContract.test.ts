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
  resolveProbeAuthorityDecision,
  liveModelUnresolvedClassification,
  resolveModelAuthorityDimensions,
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

describe('resolveProbeAuthorityDecision (discovery-state-driven authority)', () => {
  const base = {
    explicitModelRequested: false,
    isLocalProvider: false,
    bundledFallbackCount: 10,
    liveDiscoveryCount: 0,
  };

  it('NOT_ATTEMPTED must not masquerade as successful-empty discovery', () => {
    const decision = resolveProbeAuthorityDecision({
      ...base,
      discoveryState: 'NOT_ATTEMPTED',
    });
    expect(decision.authority).toBe('STATIC_AUTHORITATIVE');
    expect(decision.probeAllowed).toBe(true);
    // Critically: NOT LIVE_MODEL_UNRESOLVED.
    expect(decision.classificationCode).not.toBe('LIVE_MODEL_UNRESOLVED');
  });

  it('local ECONNREFUSED-style SERVER_UNAVAILABLE is an environment blocker, not LIVE_MODEL_UNRESOLVED', () => {
    const decision = resolveProbeAuthorityDecision({
      ...base,
      discoveryState: 'SERVER_UNAVAILABLE',
      isLocalProvider: true,
    });
    expect(decision.probeAllowed).toBe(false);
    expect(decision.classificationCode).toBe('SERVER_UNAVAILABLE');
    expect(
      classifyBatchResult({
        provider: 'ollama',
        code: decision.classificationCode,
      }).className,
    ).toBe('SERVER_UNAVAILABLE');
  });

  it('auth discovery failure is AUTH_BLOCKED, never LIVE_MODEL_UNRESOLVED', () => {
    const decision = resolveProbeAuthorityDecision({
      ...base,
      discoveryState: 'AUTH_BLOCKED',
    });
    expect(decision.probeAllowed).toBe(false);
    expect(decision.classificationCode).toBe('AUTH_REQUIRED');
    expect(
      classifyBatchResult({
        provider: 'cloud',
        code: decision.classificationCode,
      }).className,
    ).toBe('AUTH_BLOCKED');
  });

  it('successful empty authoritative discovery is the ONLY LIVE_MODEL_UNRESOLVED justification', () => {
    const decision = resolveProbeAuthorityDecision({
      ...base,
      discoveryState: 'SUCCEEDED_EMPTY',
    });
    expect(decision.authority).toBe('LIVE_FALLBACK');
    expect(decision.probeAllowed).toBe(false);
    expect(decision.classificationCode).toBe('LIVE_MODEL_UNRESOLVED');
  });

  it('a static-authoritative provider may probe with its bundled catalog without claiming live discovery', () => {
    const decision = resolveProbeAuthorityDecision({
      ...base,
      discoveryState: 'UNSUPPORTED',
      bundledFallbackCount: 161,
    });
    expect(decision.authority).toBe('STATIC_AUTHORITATIVE');
    expect(decision.probeAllowed).toBe(true);
    expect(decision.classificationCode).toBe('OK');
  });

  it('a static provider with NO bundled models is ROUTE_UNRESOLVED', () => {
    const decision = resolveProbeAuthorityDecision({
      ...base,
      discoveryState: 'UNSUPPORTED',
      bundledFallbackCount: 0,
    });
    expect(decision.probeAllowed).toBe(false);
    expect(decision.classificationCode).toBe('ROUTE_NOT_FOUND');
  });

  it('live discovery SUCCEEDED_NONEMPTY permits the probe as LIVE_DISCOVERED (SERVER_DISCOVERED for local)', () => {
    const remote = resolveProbeAuthorityDecision({
      ...base,
      discoveryState: 'SUCCEEDED_NONEMPTY',
      liveDiscoveryCount: 3,
    });
    expect(remote.authority).toBe('LIVE_DISCOVERED');
    expect(remote.probeAllowed).toBe(true);

    const local = resolveProbeAuthorityDecision({
      ...base,
      discoveryState: 'SUCCEEDED_NONEMPTY',
      isLocalProvider: true,
      liveDiscoveryCount: 3,
    });
    expect(local.authority).toBe('SERVER_DISCOVERED');
  });

  it('an explicit --model always permits the probe (USER_EXPLICIT)', () => {
    const decision = resolveProbeAuthorityDecision({
      ...base,
      discoveryState: 'NOT_ATTEMPTED',
      explicitModelRequested: true,
    });
    expect(decision.authority).toBe('USER_EXPLICIT');
    expect(decision.probeAllowed).toBe(true);
  });
});

describe('honest PASS invariant (structural proof, not absence of error)', () => {
  // Regression E: structuredToolProtocol=false + safeError none must never
  // be classified PASS merely because no transport error occurred.
  it('E. code=OK with structuredToolCalls=false is INCONCLUSIVE, never PASS', () => {
    const r = classifyBatchResult({
      provider: 'opencode-go',
      code: 'OK',
      structuredToolCalls: false,
    });
    expect(r.className).toBe('INCONCLUSIVE');
  });

  // Regression F: auto/no-call downgrade with no error is inconclusive, not
  // a failure and not a fabricated pass.
  it('F. zero normalized calls with a full-proof shape is INCONCLUSIVE', () => {
    const r = classifyBatchResult({
      provider: 'opencode-go',
      code: 'OK',
      normalizedToolCalls: 0,
      schedulerExecutions: 0,
      toolResults: 0,
      resultReinjected: false,
      continuationCompleted: false,
    });
    expect(r.className).toBe('INCONCLUSIVE');
  });

  // Regression H: the full structured-tool chain proven end-to-end is the
  // only shape that earns PASS.
  it('H. a fully proven structured-tool chain is PASS', () => {
    const r = classifyBatchResult({
      provider: 'opencode-go',
      code: 'OK',
      structuredToolCalls: true,
      normalizedToolCalls: 1,
      schedulerExecutions: 1,
      toolResults: 1,
      resultReinjected: true,
      continuationCompleted: true,
    });
    expect(r.className).toBe('PASS');
  });

  it('a partial chain (calls observed but reinjection/continuation incomplete) is INCONCLUSIVE, not PASS', () => {
    const r = classifyBatchResult({
      provider: 'opencode-go',
      code: 'OK',
      structuredToolCalls: true,
      normalizedToolCalls: 1,
      schedulerExecutions: 1,
      toolResults: 1,
      resultReinjected: true,
      continuationCompleted: false,
    });
    expect(r.className).toBe('INCONCLUSIVE');
  });

  it('legacy callers supplying only `code` (no proof at all) keep PASS for a PASS-mapped code', () => {
    const r = classifyBatchResult({ provider: 'mix', code: 'OK' });
    expect(r.className).toBe('PASS');
  });
});

describe('batch counters mutually exclusive sum (regression I)', () => {
  it('I. INCONCLUSIVE participates in the sum invariant alongside every other class', () => {
    const results: ClassifiedBatchResult[] = [
      classifyBatchResult({
        provider: 'a',
        code: 'OK',
        structuredToolCalls: false,
      }),
      classifyBatchResult({ provider: 'b', code: 'AUTH_REQUIRED' }),
      classifyBatchResult({
        provider: 'c',
        code: 'OK',
        structuredToolCalls: true,
        normalizedToolCalls: 1,
        schedulerExecutions: 1,
        toolResults: 1,
        resultReinjected: true,
        continuationCompleted: true,
      }),
    ];
    const breakdown = computeBatchBreakdown(results, results.length);
    expect(breakdown.inconclusive).toBe(1);
    expect(breakdown.authBlocked).toBe(1);
    expect(breakdown.pass).toBe(1);
    expect(breakdown.sum).toBe(results.length);
    expect(breakdown.sumMatchesConfigured).toBe(true);
  });
});

describe('resolveModelAuthorityDimensions (regression F: discovery membership != account usability)', () => {
  it('F. a model present in discovery with no live request attempted is UNKNOWN usability, never inferred VERIFIED_AVAILABLE — the exact gpt-5.5 shape (discovered, live 400 model_not_supported)', () => {
    // Discovery membership alone (no request attempted yet).
    const beforeRequest = resolveModelAuthorityDimensions({
      discovered: true,
    });
    expect(beforeRequest.discoveryStatus).toBe('DISCOVERED');
    expect(beforeRequest.accountUsability).toBe('UNKNOWN');

    // The live request evidence then proves it unavailable for THIS
    // account — discovery membership never changes, only usability does.
    const afterRequest = resolveModelAuthorityDimensions({
      discovered: true,
      liveRequestOutcome: 'MODEL_NOT_AVAILABLE',
    });
    expect(afterRequest.discoveryStatus).toBe('DISCOVERED');
    expect(afterRequest.accountUsability).toBe('VERIFIED_UNAVAILABLE');
  });

  it('a successful live request proves VERIFIED_AVAILABLE', () => {
    const result = resolveModelAuthorityDimensions({
      discovered: true,
      liveRequestOutcome: 'SUCCEEDED',
    });
    expect(result.accountUsability).toBe('VERIFIED_AVAILABLE');
  });

  it('an unrelated failure (e.g. auth) proves nothing about model usability — stays UNKNOWN, never VERIFIED_UNAVAILABLE', () => {
    const result = resolveModelAuthorityDimensions({
      discovered: true,
      liveRequestOutcome: 'OTHER_FAILURE',
    });
    expect(result.accountUsability).toBe('UNKNOWN');
  });

  it('a model absent from discovery is NOT_DISCOVERED regardless of usability evidence', () => {
    const result = resolveModelAuthorityDimensions({
      discovered: false,
      liveRequestOutcome: 'SUCCEEDED',
    });
    expect(result.discoveryStatus).toBe('NOT_DISCOVERED');
    // Usability can still be proven even for a model reached via an
    // explicit --model request outside the discovered set.
    expect(result.accountUsability).toBe('VERIFIED_AVAILABLE');
  });
});

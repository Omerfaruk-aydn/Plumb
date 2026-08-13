/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Honest batch tool-route probe result classification. A provider batch probe
 * must never lump orthogonal outcomes (AUTH_REQUIRED, MODEL_NOT_AVAILABLE,
 * ROUTE_NOT_FOUND, NETWORK_ERROR, ...) into a single misleading "failed"
 * bucket. This module owns the mutually-exclusive classification, the
 * sum-invariant breakdown, and the LIVE_MODEL_UNRESOLVED rule for routes that
 * only have bundled fallback models (never trust a bundled fallback as if it
 * were live authority).
 */

// ─── Mutually exclusive batch result classes ────────────────────────────

export type BatchResultClass =
  | 'PASS'
  | 'REQUEST_FAILED'
  | 'AUTH_BLOCKED'
  | 'MODEL_UNAVAILABLE'
  | 'SERVER_UNAVAILABLE'
  | 'ROUTE_UNRESOLVED'
  | 'PROTOCOL_UNSUPPORTED'
  | 'LIVE_MODEL_UNRESOLVED'
  | 'UNKNOWN';

export const BATCH_RESULT_CLASSES: readonly BatchResultClass[] = [
  'PASS',
  'REQUEST_FAILED',
  'AUTH_BLOCKED',
  'MODEL_UNAVAILABLE',
  'SERVER_UNAVAILABLE',
  'ROUTE_UNRESOLVED',
  'PROTOCOL_UNSUPPORTED',
  'LIVE_MODEL_UNRESOLVED',
  'UNKNOWN',
];

/** Local providers where an offline process means SERVER_UNAVAILABLE, not a
 * structured-tool failure or a route-capability downgrade. */
const LOCAL_PROVIDERS = new Set<string>([
  'litellm',
  'ollama',
  'lm-studio',
  'lmstudio',
  'llamacpp',
  'llama.cpp',
  'vllm',
  'vllm-serve',
  'sglang',
]);

export function isLocalProvider(provider: string): boolean {
  return LOCAL_PROVIDERS.has(provider);
}

function classifyCode(
  code: string,
  context: { localProvider: boolean },
): BatchResultClass {
  const c = code.toUpperCase();

  // Network reachability problems for BOTH local and remote providers mean
  // the server could not be reached — never a tool-protocol failure. (For
  // local providers this additionally must NOT reduce route capability.)
  if (
    c === 'NETWORK_ERROR' ||
    c === 'ECONNREFUSED' ||
    c === 'CONNECTION_REFUSED' ||
    c === 'ENOTFOUND' ||
    c === 'REQUEST_TIMEOUT' ||
    c === 'TIMEOUT'
  ) {
    return 'SERVER_UNAVAILABLE';
  }

  switch (c) {
    case 'NO_TOOL_CALLS':
    case 'OK':
    case 'TOOL_CALL_REINJECTED':
      return 'PASS';
    case 'AUTH_REQUIRED':
    case 'ACCOUNT_RESTRICTED':
    case 'MISSING_CREDENTIAL':
    case 'UNAUTHENTICATED':
    case 'AUTH_BLOCKED':
      return 'AUTH_BLOCKED';
    case 'MODEL_NOT_AVAILABLE':
    case 'ENDPOINT_NOT_FOUND':
    case 'MODEL_DOES_NOT_EXIST':
      return 'MODEL_UNAVAILABLE';
    case 'ROUTE_NOT_FOUND':
    case 'NO_MODEL':
    case 'TRANSPORT_NOT_REGISTERED':
      return 'ROUTE_UNRESOLVED';
    case 'PROTOCOL_UNSUPPORTED':
    case 'TOOL_CAPABILITY_INVARIANT':
    case 'FORCED_SELECTOR_WITH_ZERO_TOOLS':
      return 'PROTOCOL_UNSUPPORTED';
    case 'LIVE_MODEL_UNRESOLVED':
      return 'LIVE_MODEL_UNRESOLVED';
    case 'INVALID_REQUEST':
    case 'PAYLOAD_VALIDATION_FAILED':
      // Provider rejected a well-formed request — a real request failure.
      return 'REQUEST_FAILED';
    default:
      // AUTH/BLOCKED / MODEL / ROUTE / NETWORK are explicitly NOT
      // "tool-runtime failures". Anything unrecognized is reported honestly
      // as UNKNOWN rather than mis-labeled REQUEST_FAILED or fake PASS.
      return 'UNKNOWN';
  }
}

export interface BatchProbeResult {
  readonly provider: string;
  readonly code: string;
  readonly structuredToolCalls: boolean;
}

export interface ClassifiedBatchResult {
  readonly provider: string;
  readonly code: string;
  readonly className: BatchResultClass;
  readonly isToolRuntimeFailure: boolean;
}
export function classifyBatchResult(
  result: Pick<BatchProbeResult, 'code'> & { provider?: string },
): ClassifiedBatchResult {
  const provider = result.provider ?? '';
  const className = classifyCode(result.code, {
    localProvider: isLocalProvider(provider),
  });
  return {
    provider,
    code: result.code,
    className,
    // Only genuine request failures are tool-runtime failures. Auth/model/
    // server/route problems and bundled-fallback-only live gaps are NOT.
    isToolRuntimeFailure: className === 'REQUEST_FAILED',
  };
}

// ─── Sum-invariant breakdown ────────────────────────────────────────────

export interface BatchBreakdownCounters {
  pass: number;
  requestFailure: number;
  authBlocked: number;
  modelUnavailable: number;
  serverUnavailable: number;
  routeUnresolved: number;
  protocolUnsupported: number;
  liveModelUnresolved: number;
  unknown: number;
  configuredTotal: number;
}

export interface BatchBreakdown extends BatchBreakdownCounters {
  /** Must equal `configuredTotal`. */
  sum: number;
  readonly sumMatchesConfigured: boolean;
}

export const ZERO_BATCH_COUNTERS: Omit<
  BatchBreakdownCounters,
  'configuredTotal'
> = {
  pass: 0,
  requestFailure: 0,
  authBlocked: 0,
  modelUnavailable: 0,
  serverUnavailable: 0,
  routeUnresolved: 0,
  protocolUnsupported: 0,
  liveModelUnresolved: 0,
  unknown: 0,
};

export function computeBatchBreakdown(
  results: ReadonlyArray<ClassifiedBatchResult>,
  configuredTotal: number,
): BatchBreakdown {
  const counters = { ...ZERO_BATCH_COUNTERS };
  for (const r of results) {
    switch (r.className) {
      case 'PASS':
        counters.pass++;
        break;
      case 'REQUEST_FAILED':
        counters.requestFailure++;
        break;
      case 'AUTH_BLOCKED':
        counters.authBlocked++;
        break;
      case 'MODEL_UNAVAILABLE':
        counters.modelUnavailable++;
        break;
      case 'SERVER_UNAVAILABLE':
        counters.serverUnavailable++;
        break;
      case 'ROUTE_UNRESOLVED':
        counters.routeUnresolved++;
        break;
      case 'PROTOCOL_UNSUPPORTED':
        counters.protocolUnsupported++;
        break;
      case 'LIVE_MODEL_UNRESOLVED':
        counters.liveModelUnresolved++;
        break;
      case 'UNKNOWN':
        counters.unknown++;
        break;
    }
  }
  const sum =
    counters.pass +
    counters.requestFailure +
    counters.authBlocked +
    counters.modelUnavailable +
    counters.serverUnavailable +
    counters.routeUnresolved +
    counters.protocolUnsupported +
    counters.liveModelUnresolved +
    counters.unknown;
  return {
    ...counters,
    configuredTotal,
    sum,
    sumMatchesConfigured: sum === configuredTotal,
  };
}

// ─── LIVE_MODEL_UNRESOLVED honesty (universal, every provider) ──────────

export type LiveModelAuthority =
  | 'LIVE'
  | 'EXPLICIT_OK'
  | 'LIVE_MODEL_UNRESOLVED';

export interface LiveModelAuthorityInput {
  /** Models reported by live discovery for the provider. */
  readonly liveDiscoveryCount: number;
  /** Bundled fallback models available for the provider. */
  readonly bundledFallbackCount: number;
  /** Whether the user explicitly passed `--model` (a non-empty value). */
  readonly explicitModelRequested: boolean;
  /** Whether the probe fell back to bundled models. */
  readonly fallbackUsed: boolean;
}

export function resolveLiveModelAuthority(
  input: LiveModelAuthorityInput,
): LiveModelAuthority {
  if (input.explicitModelRequested) return 'EXPLICIT_OK';
  if (input.liveDiscoveryCount > 0) return 'LIVE';
  return 'LIVE_MODEL_UNRESOLVED';
}

export function liveModelUnresolvedClassification(): BatchResultClass {
  return 'LIVE_MODEL_UNRESOLVED';
}

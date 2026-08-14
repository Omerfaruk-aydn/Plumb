/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
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
  | 'INCONCLUSIVE'
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
  'INCONCLUSIVE',
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
    case 'CONFIGURATION_REQUIRED':
    case 'PROJECT_REQUIRED':
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
    case 'SERVER_UNAVAILABLE':
      // A discovery/preflight stage already proved the server unreachable.
      return 'SERVER_UNAVAILABLE';
    case 'INVALID_REQUEST':
    case 'PAYLOAD_VALIDATION_FAILED':
      // Provider rejected a well-formed request — a real request failure.
      return 'REQUEST_FAILED';
    case 'INVALID_THINKING_TOKEN_BUDGET':
      // PLUMB itself refused to construct a valid max_tokens/thinking
      // budget pair and failed closed before any network call — this is a
      // genuine request-construction failure, same bucket as any other
      // payload-validation failure.
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
  /**
   * Optional structural protocol proof. When absent, classification falls
   * back to the legacy `structuredToolCalls` boolean (or PASS-by-default if
   * that too is absent, for callers that only ever supply `code`). When
   * present, a code that maps to PASS is only kept as PASS if the full
   * structured-tool chain is actually proven; otherwise it is downgraded to
   * INCONCLUSIVE — a probe can never be PASS merely because no transport
   * error occurred.
   */
  readonly normalizedToolCalls?: number;
  readonly schedulerExecutions?: number;
  readonly toolResults?: number;
  readonly resultReinjected?: boolean;
  readonly continuationCompleted?: boolean;
}

export interface ClassifiedBatchResult {
  readonly provider: string;
  readonly code: string;
  readonly className: BatchResultClass;
  readonly isToolRuntimeFailure: boolean;
}

type PassProofFields = Partial<
  Pick<
    BatchProbeResult,
    | 'structuredToolCalls'
    | 'normalizedToolCalls'
    | 'schedulerExecutions'
    | 'toolResults'
    | 'resultReinjected'
    | 'continuationCompleted'
  >
>;

/**
 * A code that classifies to PASS is only honestly PASS when the full
 * structured-tool chain was proven. Absence of an error is not proof: a
 * probe with `structuredToolCalls: false` (or a proof object with zero
 * normalized calls / incomplete scheduling / reinjection / continuation)
 * downgrades to INCONCLUSIVE.
 */
function refinePassClassification(result: PassProofFields): BatchResultClass {
  if (result.normalizedToolCalls === undefined) {
    // Legacy shape: only the boolean is known. Explicit false is the only
    // signal available that the chain never happened.
    return result.structuredToolCalls === false ? 'INCONCLUSIVE' : 'PASS';
  }
  const fullChain =
    result.normalizedToolCalls >= 1 &&
    (result.schedulerExecutions ?? 0) >= 1 &&
    (result.toolResults ?? 0) >= 1 &&
    result.resultReinjected === true &&
    result.continuationCompleted === true;
  return fullChain ? 'PASS' : 'INCONCLUSIVE';
}

export function classifyBatchResult(
  result: Pick<BatchProbeResult, 'code'> &
    PassProofFields & {
      provider?: string;
    },
): ClassifiedBatchResult {
  const provider = result.provider ?? '';
  const baseClass = classifyCode(result.code, {
    localProvider: isLocalProvider(provider),
  });
  const className =
    baseClass === 'PASS' ? refinePassClassification(result) : baseClass;
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
  inconclusive: number;
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
  inconclusive: 0,
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
      case 'INCONCLUSIVE':
        counters.inconclusive++;
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
    counters.inconclusive +
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

// ─── Model-discovery state (authority must distinguish attempts) ─────────

/**
 * Canonical per-provider model-discovery states. A zero live-discovery count
 * is NOT a state — NOT_ATTEMPTED, SUCCEEDED_EMPTY, AUTH_BLOCKED,
 * SERVER_UNAVAILABLE, NETWORK_FAILED, PROTOCOL_FAILED, and UNSUPPORTED are
 * different outcomes that must never be conflated.
 */
export type ModelDiscoveryState =
  | 'NOT_ATTEMPTED'
  | 'SUCCEEDED_NONEMPTY'
  | 'SUCCEEDED_EMPTY'
  | 'AUTH_BLOCKED'
  | 'NETWORK_FAILED'
  | 'SERVER_UNAVAILABLE'
  | 'PROTOCOL_FAILED'
  | 'UNSUPPORTED';

/** Authority of the model the probe may use for a provider route. */
export type ModelAuthorityKind =
  | 'STATIC_AUTHORITATIVE'
  | 'LIVE_DISCOVERED'
  | 'LIVE_FALLBACK'
  | 'USER_EXPLICIT'
  | 'SERVER_DISCOVERED'
  | 'UNKNOWN';

export interface ProbeAuthorityDecision {
  /** Authority label for the probe's model selection. */
  readonly authority: ModelAuthorityKind;
  /** Whether the live structured-tool probe may run for this provider. */
  readonly probeAllowed: boolean;
  /** Canonical classification code used when the probe may NOT run. */
  readonly classificationCode: string;
}

export interface ProbeAuthorityInput {
  readonly discoveryState: ModelDiscoveryState;
  readonly explicitModelRequested: boolean;
  readonly isLocalProvider: boolean;
  readonly bundledFallbackCount: number;
  readonly liveDiscoveryCount: number;
}

/**
 * Evidence-driven probe-authority decision:
 *   - an explicit `--model` always permits the probe (USER_EXPLICIT);
 *   - SUCCEEDED_NONEMPTY permits the probe (LIVE_DISCOVERED / local
 *     SERVER_DISCOVERED) without ever claiming a bundled model was
 *     live-discovered;
 *   - SUCCEEDED_EMPTY is the ONLY state that justifies LIVE_MODEL_UNRESOLVED;
 *   - AUTH_BLOCKED / SERVER_UNAVAILABLE / NETWORK_FAILED are environment
 *     blockers, never LIVE_MODEL_UNRESOLVED;
 *   - UNSUPPORTED / NOT_ATTEMPTED / PROTOCOL_FAILED keep the official static
 *     (bundled) catalog as valid selection authority (STATIC_AUTHORITATIVE)
 *     when one exists — bundled metadata is legitimate authority for normal
 *     operation; it is just never claimed to be LIVE.
 */
export function resolveProbeAuthorityDecision(
  input: ProbeAuthorityInput,
): ProbeAuthorityDecision {
  if (input.explicitModelRequested) {
    return {
      authority: 'USER_EXPLICIT',
      probeAllowed: true,
      classificationCode: 'OK',
    };
  }
  switch (input.discoveryState) {
    case 'SUCCEEDED_NONEMPTY':
      return {
        authority: input.isLocalProvider
          ? 'SERVER_DISCOVERED'
          : 'LIVE_DISCOVERED',
        probeAllowed: true,
        classificationCode: 'OK',
      };
    case 'SUCCEEDED_EMPTY':
      return {
        authority: 'LIVE_FALLBACK',
        probeAllowed: false,
        classificationCode: 'LIVE_MODEL_UNRESOLVED',
      };
    case 'AUTH_BLOCKED':
      return {
        authority: 'UNKNOWN',
        probeAllowed: false,
        classificationCode: 'AUTH_REQUIRED',
      };
    case 'SERVER_UNAVAILABLE':
    case 'NETWORK_FAILED':
      return {
        authority: 'UNKNOWN',
        probeAllowed: false,
        classificationCode: 'SERVER_UNAVAILABLE',
      };
    case 'UNSUPPORTED':
    case 'NOT_ATTEMPTED':
    case 'PROTOCOL_FAILED':
      return input.bundledFallbackCount > 0
        ? {
            authority: 'STATIC_AUTHORITATIVE',
            probeAllowed: true,
            classificationCode: 'OK',
          }
        : {
            authority: 'UNKNOWN',
            probeAllowed: false,
            classificationCode: 'ROUTE_NOT_FOUND',
          };
    default:
      return {
        authority: 'UNKNOWN',
        probeAllowed: false,
        classificationCode: 'PROBE_FAILED',
      };
  }
}

// ─── Account usability (discovery membership != usable-by-this-account) ──
//
// A model appearing in a provider's discovery/catalog set proves only that
// the PROVIDER offers it — never that THIS account is entitled/enabled to
// actually use it (GitHub Copilot's per-seat/per-plan model gating is the
// motivating case: `gpt-5.5` can be a live-discovered member of the
// account's 79-model catalog while the account itself is not enrolled for
// it, and upstream rejects the request with `error.param: "model"`).
// `discoveryStatus` and `accountUsability` must never be conflated.

/** Whether a model was actually observed in the live/cache discovery set —
 * NOT whether the account can use it. */
export type DiscoveryStatus = 'DISCOVERED' | 'NOT_DISCOVERED';

/**
 * Whether THIS account has been proven able to actually use the model.
 * `VERIFIED_AVAILABLE` / `VERIFIED_UNAVAILABLE` require an observed live
 * request outcome — discovery membership alone can never produce either
 * verdict. `UNKNOWN` is the only honest state before any request has been
 * attempted.
 */
export type AccountUsability =
  | 'VERIFIED_AVAILABLE'
  | 'VERIFIED_UNAVAILABLE'
  | 'UNKNOWN';

export interface ModelAuthorityDimensionsInput {
  /** Was the model observed in the live/cache discovery set for this
   * provider? (independent of whether a request was ever attempted) */
  readonly discovered: boolean;
  /**
   * The outcome of an actual live request for this model, if one was
   * attempted this cycle. `undefined` means no request was attempted —
   * `accountUsability` must then be `UNKNOWN`, never inferred from
   * `discovered` alone.
   */
  readonly liveRequestOutcome?:
    | 'SUCCEEDED'
    | 'MODEL_NOT_AVAILABLE'
    | 'OTHER_FAILURE';
}

export interface ModelAuthorityDimensions {
  readonly discoveryStatus: DiscoveryStatus;
  readonly accountUsability: AccountUsability;
}

/**
 * Resolve the `discoveryStatus` / `accountUsability` pair honestly.
 * `routeCompatibility` (MATCH/MISMATCH/UNKNOWN) is a third, independent
 * dimension already owned by `ResolvedModelSelection.routeAuthority` in
 * `registry/model-registry.ts` — this function does not duplicate it.
 */
export function resolveModelAuthorityDimensions(
  input: ModelAuthorityDimensionsInput,
): ModelAuthorityDimensions {
  const discoveryStatus: DiscoveryStatus = input.discovered
    ? 'DISCOVERED'
    : 'NOT_DISCOVERED';
  let accountUsability: AccountUsability = 'UNKNOWN';
  if (input.liveRequestOutcome === 'SUCCEEDED') {
    accountUsability = 'VERIFIED_AVAILABLE';
  } else if (input.liveRequestOutcome === 'MODEL_NOT_AVAILABLE') {
    accountUsability = 'VERIFIED_UNAVAILABLE';
  }
  return { discoveryStatus, accountUsability };
}

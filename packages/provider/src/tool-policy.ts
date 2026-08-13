/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  PlumbModel,
  PlumbRouteToolPolicy,
  PlumbToolChoice,
} from './types.js';

const OPTIONAL_DEFAULT: PlumbRouteToolPolicy = {
  emission: 'OPTIONAL',
  forcedToolChoiceSupported: true,
  namedToolChoiceSupported: true,
  source: 'DIALECT_DEFAULT',
};

/**
 * Resolve policy from the complete route descriptor, never from a bare model
 * id. Catalog routes carry an OMP-projected policy. The NVIDIA contract is an
 * endpoint/provider rule because NIM's OpenAI-compatible function-calling
 * surface requires explicit activation when tools are supplied.
 */
export function resolveRouteToolPolicy(
  model: Pick<PlumbModel, 'provider' | 'api' | 'baseUrl' | 'toolPolicy'>,
): PlumbRouteToolPolicy {
  if (model.toolPolicy) return model.toolPolicy;

  const host = safeHostname(model.baseUrl);
  const isNvidiaNim =
    model.api === 'openai-completions' &&
    (model.provider === 'nvidia' ||
      host === 'integrate.api.nvidia.com' ||
      host.endsWith('.api.nvidia.com'));
  if (isNvidiaNim) {
    return {
      emission: 'REQUIRED_WHEN_TOOLS_PRESENT',
      forcedToolChoiceSupported: true,
      namedToolChoiceSupported: true,
      source: 'PROVIDER_CONTRACT',
    };
  }

  return OPTIONAL_DEFAULT;
}

export interface EffectiveToolChoice {
  readonly value?: PlumbToolChoice;
  readonly sent: boolean;
  readonly downgraded: boolean;
}

export function resolveEffectiveToolChoice(
  policy: PlumbRouteToolPolicy,
  requested: PlumbToolChoice | undefined,
  toolsCount: number,
): EffectiveToolChoice {
  if (toolsCount === 0 || policy.emission === 'FORBIDDEN') {
    return { sent: false, downgraded: requested !== undefined };
  }

  let value = requested;
  let downgraded = false;
  if (value?.mode === 'named' && !policy.namedToolChoiceSupported) {
    value = policy.forcedToolChoiceSupported
      ? { mode: 'required' }
      : { mode: 'auto' };
    downgraded = true;
  } else if (
    (value?.mode === 'required' || value?.mode === 'named') &&
    !policy.forcedToolChoiceSupported
  ) {
    value = { mode: 'auto' };
    downgraded = true;
  }

  if (!value && policy.emission === 'REQUIRED_WHEN_TOOLS_PRESENT') {
    value = { mode: 'auto' };
  }
  return { value, sent: value !== undefined, downgraded };
}

export function describeToolChoiceValue(
  choice: PlumbToolChoice | undefined,
): 'absent' | 'auto' | 'required' | 'none' | 'named' {
  return choice?.mode ?? 'absent';
}

function safeHostname(baseUrl: string | undefined): string {
  if (!baseUrl) return '';
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// ─── DIALECT vs ROUTE tool-choice capability separation ─────────────────
//
// A dialect-level serializer supporting a selector (`source: DIALECT_*`) only
// proves PLUMB knows how to *serialize* that concept. It does NOT prove the
// provider route actually accepts it. Effective route support must never be
// upgraded to SUPPORTED merely because the dialect implements it.

export type ToolChoiceCapability = 'SUPPORTED' | 'UNKNOWN' | 'NOT_SUPPORTED';

/**
 * Providers/routes with authoritative proof that a forced (required) and/or
 * named tool-choice selector is accepted end-to-end. Absent live proof a
 * route stays UNVERIFIED and its forced/named capability is UNKNOWN (never
 * fabricated as SUPPORTED). OpenCode Go/Zen live passes are preserved here.
 */
export type ProviderRouteToolChoiceProof = 'VERIFIED' | 'UNVERIFIED';

const ROUTE_PROOF: Record<string, ProviderRouteToolChoiceProof> = {
  // OpenCode Go live probe passes named/required forced selection.
  'opencode-go': 'VERIFIED',
  // OpenCode Zen previously worked interactively with a forced selector.
  'opencode-zen': 'VERIFIED',
};

export function resolveProviderRouteToolChoiceProof(
  provider: string,
): ProviderRouteToolChoiceProof {
  return ROUTE_PROOF[provider] ?? 'UNVERIFIED';
}

export interface DialectToolChoiceCapability {
  readonly auto: ToolChoiceCapability;
  readonly required: ToolChoiceCapability;
  readonly named: ToolChoiceCapability;
  readonly source: PlumbRouteToolPolicy['source'];
}

export interface RouteToolChoiceCapability {
  readonly auto: ToolChoiceCapability;
  readonly required: ToolChoiceCapability;
  readonly named: ToolChoiceCapability;
  readonly providerProof: ProviderRouteToolChoiceProof;
  readonly routeVerified: boolean;
}

/**
 * Dialect-level capability derived from what the serializer can emit. This is
 * intentionally separate from route capability (see below).
 */
export function deriveDialectToolChoiceCapability(
  policy: Pick<
    PlumbRouteToolPolicy,
    'forcedToolChoiceSupported' | 'namedToolChoiceSupported' | 'source'
  >,
): DialectToolChoiceCapability {
  const required = policy.forcedToolChoiceSupported
    ? 'SUPPORTED'
    : 'NOT_SUPPORTED';
  const named = policy.namedToolChoiceSupported ? 'SUPPORTED' : 'NOT_SUPPORTED';
  return {
    auto: 'SUPPORTED',
    required,
    named,
    source: policy.source,
  };
}

/**
 * Effective route capability. Without VERIFIED provider-route proof, a
 * dialect-flag of SUPPORTED for forced/named must be downgraded to UNKNOWN.
 * auto is only downgraded for routes whose proof is absent AND whose dialect
 * does not guarantee auto — here auto remains supported for routes we can
 * serialize, but forced/named stay honest.
 */
export function deriveRouteToolChoiceCapability(
  provider: string,
  dialect: DialectToolChoiceCapability,
): RouteToolChoiceCapability {
  const proof = resolveProviderRouteToolChoiceProof(provider);
  const routeVerified = proof === 'VERIFIED';
  const routeForced = routeVerified ? dialect.required : 'UNKNOWN';
  const routeNamed = routeVerified ? dialect.named : 'UNKNOWN';
  return {
    auto: dialect.auto === 'SUPPORTED' ? 'SUPPORTED' : 'UNKNOWN',
    required: routeForced,
    named: routeNamed,
    providerProof: proof,
    routeVerified,
  };
}

/**
 * Effective *probe* policy for a route that lacks verified forced/named
 * proof. Used so a forced diagnostic does not fabricate named/required
 * support on an unverified route: it falls back to `auto` when auto is
 * route-safe, otherwise omits the selector entirely and reports that the
 * route cannot be deterministically forced.
 */
export function resolveHonestProbeToolChoice(
  route: RouteToolChoiceCapability,
  forcedToolChoiceSupported: boolean,
  namedToolChoiceSupported: boolean,
): PlumbToolChoice | undefined {
  if (route.routeVerified) {
    if (forcedToolChoiceSupported && namedToolChoiceSupported) {
      return { mode: 'named', name: 'plumb_tool_probe' };
    }
    if (forcedToolChoiceSupported) return { mode: 'required' };
  }
  // No verified forced proof: use auto only if it is route-supported, else
  // omit the selector entirely and report the route cannot be forced.
  if (route.auto === 'SUPPORTED') return { mode: 'auto' };
  return undefined;
}

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

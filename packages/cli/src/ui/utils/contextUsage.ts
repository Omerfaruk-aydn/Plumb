/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { tokenLimit, hasKnownTokenLimit } from '@google/gemini-cli-core';

/**
 * False only when the active model's real context window has been
 * explicitly confirmed UNKNOWN (see tokenLimits.ts). Callers that render
 * a percentage/number to the user must check this first and show an
 * honest unknown state instead of a percentage computed against the
 * internal safety-budget fallback `tokenLimit()` otherwise returns.
 */
export function isContextLimitKnown(model: string | undefined): boolean {
  if (!model || typeof model !== 'string' || model.length === 0) {
    return false;
  }
  return hasKnownTokenLimit(model);
}

export function getContextUsagePercentage(
  promptTokenCount: number,
  model: string | undefined,
): number {
  if (!model || typeof model !== 'string' || model.length === 0) {
    return 0;
  }
  const limit = tokenLimit(model);
  if (limit <= 0) {
    return 0;
  }
  return promptTokenCount / limit;
}

export function isContextUsageHigh(
  promptTokenCount: number,
  model: string | undefined,
  threshold = 0.6,
): boolean {
  return getContextUsagePercentage(promptTokenCount, model) > threshold;
}

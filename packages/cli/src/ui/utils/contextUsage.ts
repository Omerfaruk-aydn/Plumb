/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { tokenLimit, hasKnownTokenLimit } from '@plumb/core';

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

/**
 * Usage level past which a bare percentage stops being enough and the UI
 * should surface an actionable next step (run /compress), not just a
 * color change. Shared so every context-usage surface (the full
 * ContextVisualization panel, the compact footer indicator) agrees on the
 * same "this is now urgent" line.
 */
export const CONTEXT_USAGE_CRITICAL_THRESHOLD = 0.9;

export function isContextUsageCritical(
  promptTokenCount: number,
  model: string | undefined,
): boolean {
  return (
    getContextUsagePercentage(promptTokenCount, model) >=
    CONTEXT_USAGE_CRITICAL_THRESHOLD
  );
}

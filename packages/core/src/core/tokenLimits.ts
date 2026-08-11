/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_MODEL,
  PREVIEW_GEMINI_FLASH_MODEL,
  PREVIEW_GEMINI_MODEL,
  GEMMA_4_31B_IT_MODEL,
  GEMMA_4_26B_A4B_IT_MODEL,
} from '../config/models.js';

type Model = string;
type TokenCount = number;

export const DEFAULT_TOKEN_LIMIT = 1_048_576;
export const GEMMA_4_TOKEN_LIMIT = 256_000;

/**
 * Real per-model context windows observed from PLUMB's provider registry
 * (see recordPlumbModelContextWindow), keyed by exact model id so switching
 * models can never bleed one model's limit onto another.
 *
 * packages/core deliberately has no build-time dependency on
 * @google/gemini-cli-provider (no PlumbModel import, no hard package.json
 * dependency — see plumbContentGenerator.ts's dynamic `import()`), so this
 * function stays synchronous and dependency-free: callers that already know
 * a model's real contextWindow (plumbContentGenerator.ts resolves it from
 * the registry on every request) push it in here; tokenLimit() below reads
 * it back for the SAME model id. Before any such call for a given model id
 * (cold start), this falls through to the switch below exactly as before —
 * never a regression, just not yet warmed.
 */
const plumbContextWindowById = new Map<string, number>();

/**
 * Records the real contextWindow PLUMB's provider registry reported for
 * `modelId`, so tokenLimit()/getTruncateToolOutputThreshold() stop guessing
 * a Gemini-only default for non-Gemini providers (Claude Subscription,
 * OpenCode, Antigravity, ...) whose real limits differ. `contextWindow`
 * must be a real reported value — never fabricated by the caller; a
 * missing/non-positive value is a no-op (the previous known value, if any,
 * is left untouched rather than overwritten with a guess).
 */
export function recordPlumbModelContextWindow(
  modelId: string,
  contextWindow: number | undefined,
): void {
  if (typeof contextWindow === 'number' && contextWindow > 0) {
    plumbContextWindowById.set(modelId, contextWindow);
  }
}

/** Test-only: clears the recorded per-model context window cache. */
export function __resetPlumbContextWindowCacheForTests(): void {
  plumbContextWindowById.clear();
}

export function tokenLimit(model: Model): TokenCount {
  const knownPlumbContextWindow = plumbContextWindowById.get(model);
  if (knownPlumbContextWindow !== undefined) {
    return knownPlumbContextWindow;
  }
  // Add other models as they become relevant or if specified by config
  // Pulled from https://ai.google.dev/gemini-api/docs/models
  switch (model) {
    case GEMMA_4_31B_IT_MODEL:
    case GEMMA_4_26B_A4B_IT_MODEL:
      return GEMMA_4_TOKEN_LIMIT;
    case PREVIEW_GEMINI_MODEL:
    case PREVIEW_GEMINI_FLASH_MODEL:
    case DEFAULT_GEMINI_MODEL:
    case DEFAULT_GEMINI_FLASH_MODEL:
    case DEFAULT_GEMINI_FLASH_LITE_MODEL:
      return 1_048_576;
    default:
      return DEFAULT_TOKEN_LIMIT;
  }
}

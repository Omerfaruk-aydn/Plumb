/**
 * Copyright 2026 PLUMB contributors
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
 * @plumb/provider (no PlumbModel import, no hard package.json
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
 * Model ids PLUMB has explicitly confirmed have NO known real context
 * window (e.g. a Claude Subscription generic alias whose live-discovered
 * id has no pinned reference match — see universal-model-inventory.ts's
 * GENERIC_FLOOR case). Distinct from "never recorded" (cold start): a
 * model in this set was actively checked and found to have no honest
 * number, so tokenLimit() must say so rather than silently falling back
 * to a Gemini-only guess that a UI surface could mistake for the model's
 * real limit.
 */
const explicitlyUnknownContextModelIds = new Set<string>();

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
    explicitlyUnknownContextModelIds.delete(modelId);
  }
}

/**
 * Explicitly marks `modelId` as having a confirmed-UNKNOWN real context
 * window (as opposed to simply never having been recorded). Callers that
 * resolve model metadata (plumbContentGenerator.ts) call this when the
 * resolved model's contextWindow field itself is UNKNOWN, so
 * `hasKnownTokenLimit()` can tell "genuinely unknown" apart from "not
 * checked yet" for UI surfaces that must never present a guessed number
 * as the model's real limit. A subsequent real `recordPlumbModelContextWindow`
 * call for the same id clears this (a model can become known later, e.g.
 * once a pinned reference table entry is added).
 */
export function recordPlumbModelContextWindowUnknown(modelId: string): void {
  if (!plumbContextWindowById.has(modelId)) {
    explicitlyUnknownContextModelIds.add(modelId);
  }
}

/**
 * True when `model` has either a recorded real contextWindow or is simply
 * unrecognized (cold start / built-in Gemini fallback applies) — i.e.
 * `tokenLimit()`'s return value may be safely presented as the model's
 * real context window. False only when the model was explicitly recorded
 * as having a confirmed-UNKNOWN real limit; UI surfaces must render an
 * honest unknown state (e.g. "?") rather than calling `tokenLimit()` in
 * that case.
 */
export function hasKnownTokenLimit(model: Model): boolean {
  return !explicitlyUnknownContextModelIds.has(model);
}

/** Test-only: clears the recorded per-model context window cache. */
export function __resetPlumbContextWindowCacheForTests(): void {
  plumbContextWindowById.clear();
  explicitlyUnknownContextModelIds.clear();
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
      // NOTE: for a model in explicitlyUnknownContextModelIds, this is a
      // conservative INTERNAL safety budget for compaction/overflow
      // arithmetic only (see chatCompressionService.ts / client.ts) — it
      // must never be presented to a user as the model's real context
      // window. Callers that render a number to the UI must check
      // hasKnownTokenLimit(model) first.
      return DEFAULT_TOKEN_LIMIT;
  }
}

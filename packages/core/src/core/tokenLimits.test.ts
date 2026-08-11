/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  tokenLimit,
  DEFAULT_TOKEN_LIMIT,
  recordPlumbModelContextWindow,
  __resetPlumbContextWindowCacheForTests,
} from './tokenLimits.js';
import {
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_MODEL,
  PREVIEW_GEMINI_FLASH_MODEL,
  PREVIEW_GEMINI_MODEL,
} from '../config/models.js';

describe('tokenLimit', () => {
  it('should return the correct token limit for default models', () => {
    expect(tokenLimit(DEFAULT_GEMINI_MODEL)).toBe(1_048_576);
    expect(tokenLimit(DEFAULT_GEMINI_FLASH_MODEL)).toBe(1_048_576);
    expect(tokenLimit(DEFAULT_GEMINI_FLASH_LITE_MODEL)).toBe(1_048_576);
  });

  it('should return the correct token limit for preview models', () => {
    expect(tokenLimit(PREVIEW_GEMINI_MODEL)).toBe(1_048_576);
    expect(tokenLimit(PREVIEW_GEMINI_FLASH_MODEL)).toBe(1_048_576);
  });

  it('should return the default token limit for an unknown model', () => {
    expect(tokenLimit('unknown-model')).toBe(DEFAULT_TOKEN_LIMIT);
  });

  it('should return the default token limit if no model is provided', () => {
    // @ts-expect-error testing invalid input
    expect(tokenLimit(undefined)).toBe(DEFAULT_TOKEN_LIMIT);
  });

  it('should have the correct default token limit value', () => {
    expect(DEFAULT_TOKEN_LIMIT).toBe(1_048_576);
  });
});

// Bug 5 regression: packages/core has no build-time dependency on
// @google/gemini-cli-provider, so it can't resolve a non-Gemini model's
// real contextWindow itself -- plumbContentGenerator.ts records it here
// (from the real PLUMB registry lookup) so client-side token-budget
// bookkeeping (compaction threshold, overflow check, tool-output
// truncation) uses the model's REAL limit instead of silently falling
// back to a Gemini-only default (previously 1,048,576 for every non-Gemini
// model, e.g. Claude Subscription's real 200K -- a 5x overshoot).
describe('recordPlumbModelContextWindow / tokenLimit integration', () => {
  afterEach(() => {
    __resetPlumbContextWindowCacheForTests();
  });

  it('uses the recorded real contextWindow for a model tokenLimit has no built-in knowledge of', () => {
    recordPlumbModelContextWindow('claude-opus-4-8', 200_000);
    expect(tokenLimit('claude-opus-4-8')).toBe(200_000);
  });

  it('ignores a non-positive or missing contextWindow rather than overwriting a known value with a guess', () => {
    recordPlumbModelContextWindow('claude-opus-4-8', 200_000);
    recordPlumbModelContextWindow('claude-opus-4-8', 0);
    recordPlumbModelContextWindow('claude-opus-4-8', undefined);
    expect(tokenLimit('claude-opus-4-8')).toBe(200_000);
  });

  it('falls back to the built-in Gemini-only default for a model that was never recorded (cold start)', () => {
    expect(tokenLimit('never-seen-model')).toBe(DEFAULT_TOKEN_LIMIT);
  });

  it('CONTEXT_METADATA_BLEED = ZERO: switching between two recorded models never bleeds one limit onto the other', () => {
    recordPlumbModelContextWindow('claude-opus-4-8', 200_000);
    recordPlumbModelContextWindow('grok-4.5', 128_000);

    expect(tokenLimit('claude-opus-4-8')).toBe(200_000);
    expect(tokenLimit('grok-4.5')).toBe(128_000);
    // Switch back -- still correct, not the other model's value.
    expect(tokenLimit('claude-opus-4-8')).toBe(200_000);
  });

  it('a recorded PLUMB model never overrides a real built-in Gemini model limit unless explicitly recorded for that id', () => {
    // No recording for DEFAULT_GEMINI_MODEL -- must still use the switch.
    recordPlumbModelContextWindow('claude-opus-4-8', 200_000);
    expect(tokenLimit(DEFAULT_GEMINI_MODEL)).toBe(1_048_576);
  });
});

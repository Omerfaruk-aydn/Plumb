/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  resolveAnthropicTokenBudget,
  ANTHROPIC_OUTPUT_FALLBACK_BUFFER,
  ANTHROPIC_DEFAULT_THINKING_BUDGET,
} from './streaming.js';

describe('resolveAnthropicTokenBudget — required invariant test matrix', () => {
  it('CASE 1: maxTokens=64, thinking fallback=16000 — the exact live GitHub Copilot claude-sonnet-4.6 bug shape. Must never produce an invalid pair.', () => {
    const result = resolveAnthropicTokenBudget({
      requestedMaxTokens: 64,
      modelMaxTokens: 64000, // claude-sonnet-4.6's live-observed model.maxTokens
      thinkingRequested: true,
      // No explicit per-model effort budget resolved -> falls back to
      // ANTHROPIC_DEFAULT_THINKING_BUDGET (16000), exactly the live shape.
    });
    expect(result.invariantPass).toBe(true);
    expect(result.failClosed).toBe(false);
    expect(result.thinkingEnabledEffective).toBe(true);
    expect(result.thinkingBudgetSource).toBe('FALLBACK_DEFAULT');
    expect(result.thinkingBudgetRequested).toBe(
      ANTHROPIC_DEFAULT_THINKING_BUDGET,
    );
    // The core invariant: effective max_tokens must strictly exceed the
    // effective thinking budget.
    expect(result.effectiveMaxTokens).toBeGreaterThan(
      result.thinkingBudgetEffective!,
    );
    expect(result.adjusted).toBe(true);
    expect(result.adjustmentReason).toBe('MAX_TOKENS_RAISED');
    // Never exceeds the model's true max output authority.
    expect(result.effectiveMaxTokens).toBeLessThanOrEqual(64000);
  });

  it('CASE 2: maxTokens=32000, budget=16000 — already a valid pair, unchanged', () => {
    const result = resolveAnthropicTokenBudget({
      requestedMaxTokens: 32000,
      modelMaxTokens: 64000,
      thinkingRequested: true,
      thinkingBudgetRequested: 16000,
    });
    expect(result.effectiveMaxTokens).toBe(32000);
    expect(result.thinkingBudgetEffective).toBe(16000);
    expect(result.adjusted).toBe(false);
    expect(result.adjustmentReason).toBe('NONE');
    expect(result.invariantPass).toBe(true);
  });

  it('CASE 3: maxTokens=16000, budget=16000 — equality is invalid ("must be greater than"), must not send the invalid equal pair', () => {
    const result = resolveAnthropicTokenBudget({
      requestedMaxTokens: 16000,
      modelMaxTokens: 64000,
      thinkingRequested: true,
      thinkingBudgetRequested: 16000,
    });
    expect(result.invariantPass).toBe(true);
    expect(result.effectiveMaxTokens).toBeGreaterThan(
      result.thinkingBudgetEffective!,
    );
    expect(result.adjusted).toBe(true);
  });

  it('CASE 4: maxTokens=8000, budget fallback=16000 — canonical policy resolves (raise bounded by model max) or fails locally; never sends the invalid pair', () => {
    const result = resolveAnthropicTokenBudget({
      requestedMaxTokens: 8000,
      modelMaxTokens: 64000,
      thinkingRequested: true,
    });
    if (result.failClosed) {
      expect(result.invariantPass).toBe(false);
    } else {
      expect(result.effectiveMaxTokens).toBeGreaterThan(
        result.thinkingBudgetEffective!,
      );
      expect(result.effectiveMaxTokens).toBeLessThanOrEqual(64000);
    }
  });

  it('CASE 5: thinking disabled — maxTokens unaffected', () => {
    const result = resolveAnthropicTokenBudget({
      requestedMaxTokens: 64,
      modelMaxTokens: 64000,
      thinkingRequested: false,
    });
    expect(result.effectiveMaxTokens).toBe(64);
    expect(result.thinkingEnabledEffective).toBe(false);
    expect(result.adjusted).toBe(false);
    expect(result.adjustmentReason).toBe('NONE');
    expect(result.invariantPass).toBe(true);
  });

  it('CASE 6: explicit valid budget — preserves exact intent, no adjustment', () => {
    const result = resolveAnthropicTokenBudget({
      requestedMaxTokens: 100000,
      modelMaxTokens: 200000,
      thinkingRequested: true,
      thinkingBudgetRequested: 30000,
    });
    expect(result.thinkingBudgetSource).toBe('EXPLICIT_MODEL_EFFORT_BUDGET');
    expect(result.effectiveMaxTokens).toBe(100000);
    expect(result.thinkingBudgetEffective).toBe(30000);
    expect(result.adjusted).toBe(false);
    expect(result.invariantPass).toBe(true);
  });

  it('CASE 7: explicit invalid budget — deterministic policy (raise/shrink), same cascade as a fallback budget (OMP parity: no source-based branching)', () => {
    const result = resolveAnthropicTokenBudget({
      requestedMaxTokens: 5000,
      modelMaxTokens: 64000,
      thinkingRequested: true,
      thinkingBudgetRequested: 30000,
    });
    expect(result.thinkingBudgetSource).toBe('EXPLICIT_MODEL_EFFORT_BUDGET');
    expect(result.invariantPass).toBe(true);
    expect(result.effectiveMaxTokens).toBeGreaterThan(
      result.thinkingBudgetEffective!,
    );
    expect(result.adjusted).toBe(true);
  });

  it('CASE 8: model true max output lower than the proposed corrected maxTokens — never exceed the model limit, budget shrinks instead', () => {
    const result = resolveAnthropicTokenBudget({
      requestedMaxTokens: 1000,
      modelMaxTokens: 5000, // too small to accommodate budget + buffer
      thinkingRequested: true,
      thinkingBudgetRequested: 16000,
    });
    expect(result.effectiveMaxTokens).toBeLessThanOrEqual(5000);
    if (!result.failClosed) {
      expect(result.thinkingBudgetEffective!).toBeLessThan(
        result.effectiveMaxTokens,
      );
    } else {
      expect(result.invariantPass).toBe(false);
    }
  });

  it('a genuinely impossible pair (model max too small for any positive budget) fails closed, never reaching a state that would hit the network', () => {
    const result = resolveAnthropicTokenBudget({
      requestedMaxTokens: 100,
      modelMaxTokens: ANTHROPIC_OUTPUT_FALLBACK_BUFFER - 1, // smaller than the buffer alone
      thinkingRequested: true,
      thinkingBudgetRequested: 16000,
    });
    expect(result.failClosed).toBe(true);
    expect(result.invariantPass).toBe(false);
    expect(result.thinkingEnabledEffective).toBe(false);
    expect(result.effectiveMaxTokens).toBeLessThanOrEqual(
      ANTHROPIC_OUTPUT_FALLBACK_BUFFER - 1,
    );
  });

  it("a zero/negative resolved budget is a no-op (mirrors OMP's budgetTokens<=0 guard) — thinking effectively off, no adjustment", () => {
    const result = resolveAnthropicTokenBudget({
      requestedMaxTokens: 4096,
      modelMaxTokens: 64000,
      thinkingRequested: true,
      thinkingBudgetRequested: 0,
    });
    expect(result.thinkingEnabledEffective).toBe(false);
    expect(result.effectiveMaxTokens).toBe(4096);
    expect(result.invariantPass).toBe(true);
    expect(result.failClosed).toBe(false);
  });

  it('no explicit requestedMaxTokens defaults to the model max, still respecting the invariant', () => {
    const result = resolveAnthropicTokenBudget({
      modelMaxTokens: 64000,
      thinkingRequested: true,
      thinkingBudgetRequested: 16000,
    });
    expect(result.requestedMaxTokens).toBeUndefined();
    expect(result.effectiveMaxTokens).toBeLessThanOrEqual(64000);
    expect(result.effectiveMaxTokens).toBeGreaterThan(
      result.thinkingBudgetEffective!,
    );
  });

  it('never exceeds modelMaxTokens even when raising is required (item 8: model max output remains authoritative)', () => {
    const result = resolveAnthropicTokenBudget({
      requestedMaxTokens: 100,
      modelMaxTokens: 20000,
      thinkingRequested: true,
      thinkingBudgetRequested: 16000,
    });
    expect(result.effectiveMaxTokens).toBeLessThanOrEqual(20000);
  });
});

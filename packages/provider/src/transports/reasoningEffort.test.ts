/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { resolveReasoningEffortRequest } from './streaming.js';

describe('resolveReasoningEffortRequest — required capability test matrix', () => {
  it('CASE 1: requested effort is in the supported list -> sent as requested', () => {
    const result = resolveReasoningEffortRequest({
      requestedEffort: 'high',
      openaiCompatReasoningEffort: true,
      supportedEfforts: ['low', 'medium', 'high'],
    });
    expect(result.capability).toBe('SUPPORTED');
    expect(result.capabilitySource).toBe('OMP_COMPAT');
    expect(result.sent).toBe(true);
    expect(result.effective).toBe('high');
  });

  it('CASE 2: explicitly unsupported (openaiCompat.reasoningEffort === false) -> never sent, regardless of request', () => {
    const result = resolveReasoningEffortRequest({
      requestedEffort: 'high',
      openaiCompatReasoningEffort: false,
    });
    expect(result.capability).toBe('UNSUPPORTED');
    expect(result.capabilitySource).toBe('OMP_COMPAT');
    expect(result.sent).toBe(false);
    expect(result.effective).toBeUndefined();
  });

  it('CASE 3: requested effort not in the supported list -> falls back to highest available (existing downgrade policy), never sends the invalid value', () => {
    const result = resolveReasoningEffortRequest({
      requestedEffort: 'xhigh',
      openaiCompatReasoningEffort: true,
      supportedEfforts: ['low', 'medium', 'high'],
    });
    expect(result.sent).toBe(true);
    expect(result.effective).toBe('high');
    expect(result.effective).not.toBe('xhigh');
  });

  it('CASE 4: UNKNOWN capability (no openaiCompat signal, no thinking metadata) -> never fabricates support, field is not sent. This is the exact GitHub Copilot kimi-k2.7-code live shape.', () => {
    const result = resolveReasoningEffortRequest({
      requestedEffort: 'high',
      // model.openaiCompat is undefined for Copilot's live-discovered kimi
      // (no bundled catalog entry, discovery never populates openaiCompat).
      openaiCompatReasoningEffort: undefined,
      thinkingMode: undefined,
      supportedEfforts: undefined,
    });
    expect(result.capability).toBe('UNKNOWN');
    expect(result.capabilitySource).toBe('UNKNOWN');
    expect(result.sent).toBe(false);
    expect(result.effective).toBeUndefined();
  });

  it('CASE 5: no collision with Anthropic thinking — resolver only consumes openaiCompat/thinking-effort-mode signals, never touches budget_tokens concepts', () => {
    // A model using Anthropic 'anthropic-budget-effort' thinking mode (not
    // 'effort') must not be treated as reasoning_effort-supported by this
    // resolver, since that model dialect never uses reasoning_effort at all.
    const result = resolveReasoningEffortRequest({
      requestedEffort: 'high',
      openaiCompatReasoningEffort: undefined,
      thinkingMode: 'anthropic-budget-effort',
      supportedEfforts: ['low', 'medium', 'high'],
    });
    expect(result.capability).toBe('UNKNOWN');
    expect(result.sent).toBe(false);
  });

  it('CASE 6: same model id, two providers — provider A supports reasoning_effort, provider B does not. Resolver is called per-request with that provider/model composed metadata, so there is zero cross-provider bleed.', () => {
    const providerASupported = resolveReasoningEffortRequest({
      requestedEffort: 'high',
      openaiCompatReasoningEffort: true,
      supportedEfforts: ['low', 'medium', 'high'],
    });
    const providerBUnknown = resolveReasoningEffortRequest({
      requestedEffort: 'high',
      openaiCompatReasoningEffort: undefined,
      thinkingMode: undefined,
      supportedEfforts: undefined,
    });
    expect(providerASupported.sent).toBe(true);
    expect(providerBUnknown.sent).toBe(false);
  });

  it('CASE 7: bundled-catalog signal (thinking.mode==="effort" + supportedEfforts) supports the field even without an explicit openaiCompat boolean, and picks a default when nothing was requested', () => {
    const result = resolveReasoningEffortRequest({
      requestedEffort: undefined,
      openaiCompatReasoningEffort: undefined,
      thinkingMode: 'effort',
      supportedEfforts: ['low', 'medium', 'high'],
    });
    expect(result.capability).toBe('SUPPORTED');
    expect(result.capabilitySource).toBe('BUNDLED_CATALOG');
    expect(result.sent).toBe(true);
    expect(result.effective).toBe('high');
  });
});

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isContextUsageCritical,
  CONTEXT_USAGE_CRITICAL_THRESHOLD,
} from './contextUsage.js';

vi.mock('@plumb/core', () => ({
  hasKnownTokenLimit: () => true,
  tokenLimit: () => 100_000,
}));

describe('isContextUsageCritical', () => {
  it('is false below the critical threshold', () => {
    expect(isContextUsageCritical(50_000, 'some-model')).toBe(false);
  });

  it('is true at or above the critical threshold', () => {
    expect(
      isContextUsageCritical(
        100_000 * CONTEXT_USAGE_CRITICAL_THRESHOLD,
        'some-model',
      ),
    ).toBe(true);
    expect(isContextUsageCritical(95_000, 'some-model')).toBe(true);
  });

  it('is false when the model is undefined (unknown limit, computed percentage is 0)', () => {
    expect(isContextUsageCritical(999_999, undefined)).toBe(false);
  });
});

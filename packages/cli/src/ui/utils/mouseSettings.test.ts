/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { resolveInitialMouseMode } from './mouseSettings.js';

describe('resolveInitialMouseMode (mouse toggle)', () => {
  it("defaults to today's pre-F25 behavior (mouse follows alternate-buffer) when unset", () => {
    expect(resolveInitialMouseMode(undefined, true)).toBe(true);
    expect(resolveInitialMouseMode(undefined, false)).toBe(false);
  });

  it('respects an explicit true the same as the default', () => {
    expect(resolveInitialMouseMode(true, true)).toBe(true);
    expect(resolveInitialMouseMode(true, false)).toBe(false);
  });

  it('forces mouse capture off at startup when ui.mouse is explicitly false', () => {
    expect(resolveInitialMouseMode(false, true)).toBe(false);
    expect(resolveInitialMouseMode(false, false)).toBe(false);
  });
});

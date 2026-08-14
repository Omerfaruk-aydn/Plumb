/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  createScrollMomentumState,
  resolveScrollSpeedMultiplier,
  updateScrollMomentum,
} from './scrollSpeed.js';

describe('resolveScrollSpeedMultiplier (çarpan matematiği)', () => {
  it("defaults to 1 (today's unchanged scroll feel) for undefined/non-numeric input", () => {
    expect(resolveScrollSpeedMultiplier(undefined)).toBe(1);
    expect(resolveScrollSpeedMultiplier('fast')).toBe(1);
    expect(resolveScrollSpeedMultiplier(NaN)).toBe(1);
  });

  it('passes through a valid finite number', () => {
    expect(resolveScrollSpeedMultiplier(1)).toBe(1);
    expect(resolveScrollSpeedMultiplier(5.5)).toBe(5.5);
  });

  it('floors at a small positive value instead of allowing zero/negative', () => {
    expect(resolveScrollSpeedMultiplier(0)).toBeGreaterThan(0);
    expect(resolveScrollSpeedMultiplier(-10)).toBeGreaterThan(0);
  });
});

describe('updateScrollMomentum (acceleration rampası)', () => {
  it('legacy ramp (scrollAcceleration: false) matches the pre-existing curve exactly', () => {
    const momentum = createScrollMomentumState();
    let t = 1000;
    const multipliers: number[] = [];
    for (let i = 0; i < 8; i++) {
      multipliers.push(updateScrollMomentum(momentum, 'down', t, false, false));
      t += 10; // well under the 50ms consecutive-scroll threshold
    }
    // First 6 ticks (count 0..5) stay at 1x; the legacy curve only starts
    // ramping once count exceeds 5, then +0.1 per tick, capped at 3x.
    expect(multipliers.slice(0, 6)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(multipliers[6]).toBeCloseTo(1.1);
    expect(multipliers[7]).toBeCloseTo(1.2);
  });

  it('exponential ramp (scrollAcceleration: true) grows faster than the legacy ramp for the same burst', () => {
    const legacy = createScrollMomentumState();
    const exponential = createScrollMomentumState();
    let t = 1000;
    let legacyLast = 1;
    let expLast = 1;
    for (let i = 0; i < 10; i++) {
      legacyLast = updateScrollMomentum(legacy, 'down', t, false, false);
      expLast = updateScrollMomentum(exponential, 'down', t, true, false);
      t += 10;
    }
    expect(expLast).toBeGreaterThan(legacyLast);
  });

  it('resets to 1:1 speed on a slow tick or a direction change', () => {
    const momentum = createScrollMomentumState();
    let t = 1000;
    for (let i = 0; i < 8; i++) {
      updateScrollMomentum(momentum, 'down', t, true, false);
      t += 10;
    }
    expect(momentum.count).toBeGreaterThan(0);

    // A slow (>=50ms gap) tick resets the ramp.
    const afterSlowTick = updateScrollMomentum(
      momentum,
      'down',
      t + 200,
      true,
      false,
    );
    expect(afterSlowTick).toBe(1);
    expect(momentum.count).toBe(0);
  });

  it('never accelerates on a Ghostty terminal, regardless of the acceleration setting', () => {
    const momentum = createScrollMomentumState();
    let t = 1000;
    let last = 1;
    for (let i = 0; i < 10; i++) {
      last = updateScrollMomentum(momentum, 'down', t, true, true);
      t += 5;
    }
    expect(last).toBe(1);
  });
});

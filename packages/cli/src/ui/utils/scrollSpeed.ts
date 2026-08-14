/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F25 (PLUMB-UI-DEVRIM-PROMPT.md): scroll speed multiplier + acceleration
 * ramp math, pulled out of ScrollProvider.tsx as pure functions so the
 * curve shapes are directly testable.
 *
 * `scrollAcceleration: false` (the default) reuses PLUMB's existing ramp
 * formula verbatim (5-scroll warmup, +0.1/scroll, capped at 3x) -- the UX
 * spec requires that curve be pixel-for-pixel unchanged from before this
 * feature existed. `scrollAcceleration: true` swaps in a new exponential
 * ramp ("hızlı art arda scroll'da hız üssel artar, yavaşta 1:1").
 */

export const SCROLL_CONSECUTIVE_THRESHOLD_MS = 50;

const LEGACY_ACCEL_START_COUNT = 5;
const LEGACY_ACCEL_STEP = 0.1;
const LEGACY_ACCEL_MAX = 3;

const EXP_ACCEL_GROWTH = 1.15;
const EXP_ACCEL_MAX = 6;

const MIN_SCROLL_SPEED = 0.001;
// Matches the implicit "1 line per wheel tick" PLUMB has always scrolled at
// -- shipping this feature must not change default scroll magnitude for
// existing users (the acceleration ramp above still applies on top, exactly
// as it did before this setting existed).
const DEFAULT_SCROLL_SPEED = 1;

export interface ScrollMomentumState {
  count: number;
  lastTime: number;
  lastDirection: 'up' | 'down' | null;
}

export function createScrollMomentumState(): ScrollMomentumState {
  return { count: 0, lastTime: 0, lastDirection: null };
}

/**
 * Resolves the `ui.scrollSpeed` setting to a usable multiplier: falls back
 * to the default for anything non-numeric/non-finite, and floors at a tiny
 * positive value so `scrollSpeed: 0` can't produce a stuck zero-delta
 * scroll -- there is still a knob to turn to feel a difference, it just
 * bottoms out rather than deadlocking.
 */
export function resolveScrollSpeedMultiplier(rawSpeed: unknown): number {
  const speed =
    typeof rawSpeed === 'number' && Number.isFinite(rawSpeed)
      ? rawSpeed
      : DEFAULT_SCROLL_SPEED;
  return Math.max(MIN_SCROLL_SPEED, speed);
}

/**
 * Advances the momentum ramp for one wheel tick and returns the multiplier
 * to apply on top of `resolveScrollSpeedMultiplier()`. Mutates `momentum`
 * in place (same pattern as the ref it replaces in ScrollProvider).
 */
export function updateScrollMomentum(
  momentum: ScrollMomentumState,
  direction: 'up' | 'down',
  now: number,
  accelerationEnabled: boolean,
  isGhosttyTerminal: boolean,
): number {
  let rampMultiplier = 1;

  // Ghostty already applies its own scroll smoothing; stacking ours on top
  // double-accelerates. Matches the pre-existing ScrollProvider behavior.
  if (!isGhosttyTerminal) {
    const timeSinceLastScroll = now - momentum.lastTime;
    const isSameDirection = momentum.lastDirection === direction;

    if (
      timeSinceLastScroll < SCROLL_CONSECUTIVE_THRESHOLD_MS &&
      isSameDirection
    ) {
      momentum.count += 1;
      rampMultiplier = accelerationEnabled
        ? Math.min(EXP_ACCEL_MAX, Math.pow(EXP_ACCEL_GROWTH, momentum.count))
        : Math.min(
            LEGACY_ACCEL_MAX,
            1 +
              Math.max(0, momentum.count - LEGACY_ACCEL_START_COUNT) *
                LEGACY_ACCEL_STEP,
          );
    } else {
      // A slow tick (or a direction change) resets the ramp -- 1:1 speed.
      momentum.count = 0;
    }
  }

  momentum.lastTime = now;
  momentum.lastDirection = direction;
  return rampMultiplier;
}

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { useIsScreenReaderEnabled } from 'ink';
import tinygradient from 'tinygradient';

const DEFAULT_CYCLE_DURATION_MS = 4000;
const DEFAULT_TICK_MS = 30;

export interface UseColorCycleOptions {
  /** How long one full loop through `colors` takes, in ms. */
  durationMs?: number;
  /** How often the color is recomputed, in ms (lower = smoother, more re-renders). */
  tickMs?: number;
  /** Freeze on the first color instead of animating (e.g. reduced-motion). */
  disabled?: boolean;
}

/**
 * Cycles smoothly through a list of colors, looping back to the first.
 * Pauses automatically when a screen reader is active (colors carry no
 * meaning for it and the extra re-renders only add noise).
 *
 * Drives PlumbSpinner's gradient today. Reach for it again for any other
 * "actively happening right now" indicator, but be deliberate about where:
 * this runs a real `setInterval`, so only use it on components that are
 * either mocked out in tests or rendered sparingly (never on something like
 * a per-tool status icon that gets mounted dozens of times per test file --
 * that destabilizes the whole suite with leaked timers).
 */
export function useColorCycle(
  colors: readonly string[],
  {
    durationMs = DEFAULT_CYCLE_DURATION_MS,
    tickMs = DEFAULT_TICK_MS,
    disabled = false,
  }: UseColorCycleOptions = {},
): string {
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  const [time, setTime] = useState(0);

  const gradient = useMemo(
    () => tinygradient([...colors, colors[0]]),
    [colors],
  );

  const isAnimating = !disabled && !isScreenReaderEnabled;

  useEffect(() => {
    if (!isAnimating) {
      return;
    }
    const interval = setInterval(() => {
      setTime((prev) => prev + tickMs);
    }, tickMs);
    return () => clearInterval(interval);
  }, [isAnimating, tickMs]);

  const progress = (time % durationMs) / durationMs;
  return gradient.rgbAt(progress).toHexString();
}

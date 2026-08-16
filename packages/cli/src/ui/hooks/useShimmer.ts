/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

/**
 * Band travel speed in cells per second. Driving the sweep by a fixed
 * velocity -- rather than dividing a fixed duration by a length-derived
 * period -- keeps the motion's apparent speed identical whether the label
 * is "Thinking" or a long tool description. Taken from oh-my-pi's shimmer
 * (packages/coding-agent/src/modes/theme/shimmer.ts).
 */
const SHIMMER_SPEED_CELLS_PER_S = 30;

/** Half-width of the cosine bump, in cells. Wider = softer falloff. */
const BAND_HALF_WIDTH = 6;

/** Lead-in so the band starts off-screen rather than mid-word. */
const BAND_PADDING = 4;

/** Intensity at/above which a cell is at the band's crest. */
const TIER_HIGH = 0.65;

/** Intensity at/above which a cell is on the band's approach. */
const TIER_MID = 0.22;

/** Redraw cadence. Matches the 30fps the sweep speed is expressed against. */
const FRAME_MS = 1000 / 30;

export type ShimmerTier = 'high' | 'mid' | 'low';

/** One run of consecutive characters sharing a tier. */
export interface ShimmerSegment {
  text: string;
  tier: ShimmerTier;
}

function tierFor(intensity: number): ShimmerTier {
  if (intensity >= TIER_HIGH) return 'high';
  if (intensity >= TIER_MID) return 'mid';
  return 'low';
}

/**
 * Splits `text` into runs of consecutive same-tier characters for a light
 * band sweeping left-to-right, recomputed on each animation frame.
 *
 * Returned as segments rather than per-character so callers render a
 * handful of `<Text>` nodes per frame instead of one per character -- a
 * long label would otherwise cost hundreds of nodes every 33ms.
 *
 * Runs a real `setInterval`, so the same caution as `useColorCycle`
 * applies: only mount this on something rendered sparingly, or mocked in
 * tests. `ShimmerText`, its only consumer, is mocked suite-wide via
 * `mockShimmerText()` for exactly that reason.
 *
 * Pass `enabled: false` (reduced motion, screen reader, NO_COLOR, or a
 * settled state) to stop the timer entirely and get one flat `'low'`
 * segment back.
 */
export function useShimmer(text: string, enabled: boolean): ShimmerSegment[] {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => setTick((prev) => prev + 1), FRAME_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  if (!enabled || text.length === 0) {
    return text.length === 0 ? [] : [{ text, tier: 'low' }];
  }

  // Period spans the text plus padding on both sides, so the band fully
  // exits before re-entering instead of wrapping mid-label.
  const period = text.length + BAND_PADDING * 2;
  const elapsedSeconds = (tick * FRAME_MS) / 1000;
  const position = (elapsedSeconds * SHIMMER_SPEED_CELLS_PER_S) % period;

  const segments: ShimmerSegment[] = [];
  for (let i = 0; i < text.length; i++) {
    const distance = Math.abs(i + BAND_PADDING - position);
    const intensity =
      distance >= BAND_HALF_WIDTH
        ? 0
        : 0.5 * (1 + Math.cos((Math.PI * distance) / BAND_HALF_WIDTH));
    const tier = tierFor(intensity);
    const last = segments[segments.length - 1];
    if (last && last.tier === tier) {
      last.text += text[i];
    } else {
      segments.push({ text: text[i], tier });
    }
  }
  return segments;
}

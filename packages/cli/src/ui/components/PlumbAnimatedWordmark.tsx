/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import { renderPlumbBlockWordmark } from '@plumb/core';
import { ThemedGradient } from './ThemedGradient.js';

export interface PlumbAnimatedWordmarkProps {
  phase?: number;
  disabled?: boolean;
  fps?: number;
  terminalWidth?: number;
  isNarrow?: boolean;
  noColor?: boolean;
  screenReader?: boolean;
}

/** Ceiling on the animation rate. 30fps is smooth to the eye; past that a
 *  terminal spends more time writing escape sequences than the extra frames
 *  are worth, and Windows consoles in particular start to tear. */
const MAX_FPS = 30;

export const DEFAULT_WORDMARK_FPS = 30;

/**
 * How much hue the palette covers across the wordmark at any one instant.
 * A full 360 would put the entire rainbow inside 23 columns and read as
 * noise; a band this wide stays legible as a gradient while still being
 * unmistakably multi-colored.
 */
const HUE_SPAN_DEGREES = 200;

/**
 * Hue degrees the whole band advances each frame. At 30fps this completes a
 * full rotation in about four seconds -- fast enough to read as alive,
 * slow enough not to strobe.
 */
const DEGREES_PER_FRAME = 3;

/**
 * Colors handed to ink-gradient per frame. Enough stops that the ramp
 * interpolates smoothly across the mark, few enough that rebuilding the
 * palette every frame stays trivial.
 */
const PALETTE_STOPS = 12;

const SATURATION = 0.85;

/** Mid lightness so the mark stays readable on both dark and light terminals. */
const LIGHTNESS = 0.62;

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    [r, g, b] = [c, x, 0];
  } else if (h < 120) {
    [r, g, b] = [x, c, 0];
  } else if (h < 180) {
    [r, g, b] = [0, c, x];
  } else if (h < 240) {
    [r, g, b] = [0, x, c];
  } else if (h < 300) {
    [r, g, b] = [x, 0, c];
  } else {
    [r, g, b] = [c, 0, x];
  }

  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * Builds the palette for a given frame by sampling a continuously rotating
 * hue band.
 *
 * This is the whole point of the rewrite: the previous implementation
 * rotated a fixed 3-5 entry theme array by one *whole slot* per tick, so
 * every frame jumped a third of the way around the palette and the mark
 * visibly strobed. Sampling a continuous function instead means each frame
 * differs from the last by three degrees of hue -- the colors flow rather
 * than snap.
 */
export function buildFlowingPalette(phase: number): string[] {
  const start = phase * DEGREES_PER_FRAME;
  return Array.from({ length: PALETTE_STOPS }, (_unused, index) =>
    hslToHex(
      start + (index / (PALETTE_STOPS - 1)) * HUE_SPAN_DEGREES,
      SATURATION,
      LIGHTNESS,
    ),
  );
}

export const PlumbAnimatedWordmark: React.FC<PlumbAnimatedWordmarkProps> = ({
  phase: injectedPhase,
  disabled = false,
  fps = DEFAULT_WORDMARK_FPS,
  terminalWidth = 80,
  isNarrow = false,
  noColor = false,
  screenReader = false,
}) => {
  const [tick, setTick] = useState(0);

  const isAnimated =
    !disabled && !noColor && !screenReader && injectedPhase === undefined;
  const safeFps = Math.min(MAX_FPS, Math.max(1, fps || DEFAULT_WORDMARK_FPS));

  useEffect(() => {
    if (!isAnimated) return;
    const intervalMs = Math.max(16, Math.round(1000 / safeFps));
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isAnimated, safeFps]);

  const activeTick = injectedPhase !== undefined ? injectedPhase : tick;

  const palette = useMemo(() => buildFlowingPalette(activeTick), [activeTick]);

  if (screenReader) {
    return <Text>PLUMB</Text>;
  }

  if (isNarrow || terminalWidth < 60) {
    return <Text bold>PLUMB</Text>;
  }

  const blockText = renderPlumbBlockWordmark({ useAscii: noColor });

  if (noColor) {
    return <Text>{blockText}</Text>;
  }

  // Animation off: fall back to the theme's own gradient rather than a
  // frozen frame of the rainbow, so a user who turned this off still gets a
  // mark that matches the rest of their theme.
  if (disabled) {
    return (
      <Box flexDirection="column" flexShrink={0}>
        <ThemedGradient>
          <Text>{blockText}</Text>
        </ThemedGradient>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Gradient colors={palette}>
        <Text>{blockText}</Text>
      </Gradient>
    </Box>
  );
};

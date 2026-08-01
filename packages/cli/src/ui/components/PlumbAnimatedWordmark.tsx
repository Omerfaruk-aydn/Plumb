/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import { renderPlumbBlockWordmark } from '@google/gemini-cli-core';
import { theme } from '../semantic-colors.js';
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

function rotateArray<T>(arr: T[], offset: number): T[] {
  const len = arr.length;
  if (len === 0) return arr;
  const shift = ((offset % len) + len) % len;
  return [...arr.slice(shift), ...arr.slice(0, shift)];
}

export const PlumbAnimatedWordmark: React.FC<PlumbAnimatedWordmarkProps> = ({
  phase: injectedPhase,
  disabled = false,
  fps = 8,
  terminalWidth = 80,
  isNarrow = false,
  noColor = false,
  screenReader = false,
}) => {
  const [tick, setTick] = useState(0);

  const isAnimated =
    !disabled && !noColor && !screenReader && injectedPhase === undefined;
  const safeFps = Math.min(10, Math.max(1, fps || 8));

  useEffect(() => {
    if (!isAnimated) return;
    const intervalMs = Math.max(100, Math.floor(1000 / safeFps));
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isAnimated, safeFps]);

  const activeTick = injectedPhase !== undefined ? injectedPhase : tick;
  const gradientColors = theme.ui.gradient;

  const rotatedColors = useMemo(() => {
    if (!gradientColors || gradientColors.length < 2) return null;
    return rotateArray(gradientColors, activeTick);
  }, [gradientColors, activeTick]);

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

  if (disabled) {
    return (
      <Box flexDirection="column" flexShrink={0}>
        <ThemedGradient>
          <Text>{blockText}</Text>
        </ThemedGradient>
      </Box>
    );
  }

  if (!rotatedColors) {
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
      <Gradient colors={rotatedColors}>
        <Text>{blockText}</Text>
      </Gradient>
    </Box>
  );
};

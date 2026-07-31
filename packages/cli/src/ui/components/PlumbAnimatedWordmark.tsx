/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import colorConvert from 'color-convert';
import { renderPlumbBlockWordmark } from '@google/gemini-cli-core';

export interface PlumbAnimatedWordmarkProps {
  phase?: number;
  disabled?: boolean;
  fps?: number;
  terminalWidth?: number;
  isNarrow?: boolean;
  noColor?: boolean;
  screenReader?: boolean;
}

const BASE_HUES = [180, 220, 270, 310, 340, 30, 140, 180];

export function getRgbPaletteForPhase(phaseDegrees: number): string[] {
  return BASE_HUES.map(hue => {
    const rotated = (hue + phaseDegrees) % 360;
    return '#' + colorConvert.hsl.hex([rotated, 100, 50]);
  });
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
  const [currentPhase, setCurrentPhase] = useState(0);

  const activePhase = injectedPhase !== undefined ? injectedPhase : currentPhase;
  const isAnimated = !disabled && !noColor && !screenReader && injectedPhase === undefined;

  const safeFps = Math.min(10, Math.max(1, fps || 8));

  useEffect(() => {
    if (!isAnimated) return;

    const intervalMs = Math.max(100, Math.floor(1000 / safeFps));
    const timer = setInterval(() => {
      setCurrentPhase(prev => (prev + 15) % 360);
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }, [isAnimated, safeFps]);

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

  const colors = getRgbPaletteForPhase(activePhase);

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Gradient colors={colors}>
        <Text>{blockText}</Text>
      </Gradient>
    </Box>
  );
};

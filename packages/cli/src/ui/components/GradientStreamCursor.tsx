/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text, useIsScreenReaderEnabled } from 'ink';
import { Colors } from '../colors.js';
import { useColorCycle } from '../hooks/useColorCycle.js';

export const GradientStreamCursor: React.FC = () => {
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  const brandColors = [
    Colors.AccentPurple,
    Colors.AccentBlue,
    Colors.AccentCyan,
    Colors.AccentGreen,
    Colors.AccentYellow,
    Colors.AccentRed,
  ];
  const currentColor = useColorCycle(brandColors, { tickMs: 30 });

  if (isScreenReaderEnabled) {
    return null;
  }
  return <Text color={currentColor}>▌</Text>;
};

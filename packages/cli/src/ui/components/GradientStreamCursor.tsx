/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F3 (PLUMB-UI-DEVRIM-PROMPT.md): a gradient-cycling cursor, same
 * mechanism as GeminiSpinner (useColorCycle -- a real setInterval).
 * GeminiMessage.tsx and GeminiMessageContent.tsx, the only places this
 * mounts, must mock this component away in their own test files (the
 * way GeminiSpinner is mocked wherever it's rendered directly and
 * unmocked) -- otherwise the leaked interval produces act() warnings.
 * See GeminiMessage.test.tsx / HistoryItemDisplay.test.tsx for the mock.
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

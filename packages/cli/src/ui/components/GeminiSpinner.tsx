/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text, useIsScreenReaderEnabled } from 'ink';
import { CliSpinner } from './CliSpinner.js';
import type { SpinnerName } from 'cli-spinners';
import { Colors } from '../colors.js';
import { useColorCycle } from '../hooks/useColorCycle.js';

interface GeminiSpinnerProps {
  spinnerType?: SpinnerName;
  altText?: string;
}

export const GeminiSpinner: React.FC<GeminiSpinnerProps> = ({
  spinnerType = 'dots',
  altText,
}) => {
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  // Read fresh each render so a live theme switch is picked up, unlike a
  // module-level constant (which would freeze on whatever theme was active
  // at import time).
  const brandColors = [
    Colors.AccentPurple,
    Colors.AccentBlue,
    Colors.AccentCyan,
    Colors.AccentGreen,
    Colors.AccentYellow,
    Colors.AccentRed,
  ];
  // ~33fps for smooth color transitions.
  const currentColor = useColorCycle(brandColors, { tickMs: 30 });

  return isScreenReaderEnabled ? (
    <Text>{altText}</Text>
  ) : (
    <Text color={currentColor}>
      <CliSpinner type={spinnerType} />
    </Text>
  );
};

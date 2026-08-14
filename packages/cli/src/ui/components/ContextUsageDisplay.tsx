/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Text } from 'ink';
import { theme } from '../semantic-colors.js';
import {
  getContextUsagePercentage,
  isContextLimitKnown,
} from '../utils/contextUsage.js';
import { useSettings } from '../contexts/SettingsContext.js';
import {
  MIN_TERMINAL_WIDTH_FOR_FULL_LABEL,
  DEFAULT_COMPRESSION_THRESHOLD,
} from '../constants.js';

export const ContextUsageDisplay = ({
  promptTokenCount,
  model,
  terminalWidth,
}: {
  promptTokenCount: number;
  model: string | undefined;
  terminalWidth: number;
}) => {
  const settings = useSettings();

  if (!isContextLimitKnown(model)) {
    // The active model's real context window is confirmed UNKNOWN --
    // never present a percentage computed against the internal
    // safety-budget fallback as if it were real usage.
    return <Text color={theme.text.secondary}>?</Text>;
  }

  const percentage = getContextUsagePercentage(promptTokenCount, model);
  const percentageUsed = (percentage * 100).toFixed(0);

  const threshold =
    settings.merged.model?.compressionThreshold ??
    DEFAULT_COMPRESSION_THRESHOLD;

  let textColor = theme.text.secondary;
  if (percentage >= 1.0) {
    textColor = theme.status.error;
  } else if (percentage >= threshold) {
    textColor = theme.status.warning;
  }

  const label =
    terminalWidth < MIN_TERMINAL_WIDTH_FOR_FULL_LABEL ? '%' : '% used';

  return (
    <Text color={textColor}>
      {percentageUsed}
      {label}
    </Text>
  );
};

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';

interface ContextVisualizationProps {
  usedTokens: number;
  maxTokens: number;
  modelName?: string;
  terminalWidth: number;
  showDetails?: boolean;
}

const PROGRESS_BAR_MIN_WIDTH = 20;
const PROGRESS_BAR_MAX_WIDTH = 40;

function getUsageColor(percentage: number): string {
  if (percentage >= 0.9) return theme.status.error;
  if (percentage >= 0.7) return theme.status.warning;
  return theme.status.success;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

function renderProgressBar(percentage: number, width: number): string {
  const filled = Math.round(width * percentage);
  const empty = width - filled;
  const filledChar = '█';
  const emptyChar = '░';
  return filledChar.repeat(filled) + emptyChar.repeat(empty);
}

export const ContextVisualization: React.FC<ContextVisualizationProps> = ({
  usedTokens,
  maxTokens,
  modelName,
  terminalWidth,
  showDetails = true,
}) => {
  const percentage = maxTokens > 0 ? usedTokens / maxTokens : 0;
  const percentageDisplay = (percentage * 100).toFixed(1);
  const color = getUsageColor(percentage);

  const barWidth = Math.min(
    Math.max(PROGRESS_BAR_MIN_WIDTH, Math.floor(terminalWidth * 0.3)),
    PROGRESS_BAR_MAX_WIDTH,
  );

  const remainingTokens = maxTokens - usedTokens;
  const remainingFormatted = formatTokenCount(remainingTokens);
  const usedFormatted = formatTokenCount(usedTokens);
  const maxFormatted = formatTokenCount(maxTokens);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="row" alignItems="center">
        <Text color={color} bold>
          {' '}
        </Text>
        <Text color={theme.text.secondary}> Context </Text>
        <Text color={color}>{renderProgressBar(percentage, barWidth)}</Text>
        <Text color={color}> {percentageDisplay}%</Text>
        {modelName && <Text color={theme.text.secondary}> ({modelName})</Text>}
      </Box>

      {showDetails && (
        <Box flexDirection="row" paddingLeft={2}>
          <Text color={theme.text.secondary}>
            {usedFormatted} / {maxFormatted} tokens
          </Text>
          <Text color={theme.text.secondary}> | </Text>
          <Text
            color={
              percentage >= 0.9 ? theme.status.error : theme.text.secondary
            }
          >
            {remainingFormatted} remaining
          </Text>
        </Box>
      )}

      {percentage >= 0.9 && (
        <Box paddingLeft={2}>
          <Text color={theme.status.error} bold>
            ⚠ Context window almost full! Consider using /compact
          </Text>
        </Box>
      )}

      {percentage >= 0.7 && percentage < 0.9 && (
        <Box paddingLeft={2}>
          <Text color={theme.status.warning}>
            Context usage is getting high
          </Text>
        </Box>
      )}
    </Box>
  );
};

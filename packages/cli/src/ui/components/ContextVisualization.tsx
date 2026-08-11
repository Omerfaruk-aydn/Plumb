/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Source provenance:
 *   repository: https://github.com/chauncygu/collection-claude-code-source-code
 *   reference: claude-code-source-code/src/components/ (Claude Code context/token display)
 *   license: Apache-2.0 (collection repo)
 *   original-license: Anthropic proprietary (extracted npm package)
 *   adaptation: Original PLUMB implementation. Inspired by Claude Code context
 *     usage visualization patterns. Not copied from any specific file.
 *   substantial-similarity: LOW (independent implementation)
 *   redistribution: Apache-2.0 (original CLAUDE_CODE source: Anthropic)
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';

interface ContextVisualizationProps {
  usedTokens: number;
  /**
   * The active model's real context window, or `undefined` when it has
   * been explicitly confirmed UNKNOWN (see tokenLimits.ts:
   * hasKnownTokenLimit). Never pass an internal safety-budget fallback
   * here — undefined renders an honest "? tokens" state instead.
   */
  maxTokens: number | undefined;
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
  if (maxTokens === undefined) {
    // Confirmed-UNKNOWN real context window -- render an honest unknown
    // state rather than a percentage/bar computed against a guessed
    // number a user could mistake for the model's real limit.
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" alignItems="center">
          <Text color={theme.text.secondary}> Prompt tokens </Text>
          <Text color={theme.text.secondary}>?</Text>
          {modelName && (
            <Text color={theme.text.secondary}> ({modelName})</Text>
          )}
        </Box>
        {showDetails && (
          <Box flexDirection="row" paddingLeft={2}>
            <Text color={theme.text.secondary}>
              {formatTokenCount(usedTokens)} / ? tokens
            </Text>
          </Box>
        )}
      </Box>
    );
  }

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
        <Text color={theme.text.secondary}> Prompt tokens </Text>
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

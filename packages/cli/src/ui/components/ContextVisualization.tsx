/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { CONTEXT_USAGE_CRITICAL_THRESHOLD } from '../utils/contextUsage.js';
import { renderSparkline } from '../utils/sparkline.js';

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
  /**
   * F5 (PLUMB-UI-DEVRIM-PROMPT.md): recent per-turn prompt-token samples
   * for a sparkline, oldest first. Reactive off real telemetry updates
   * (see useTokenRateHistory.ts) — never a timer. Omit or pass fewer
   * than 2 samples to render nothing.
   */
  tokenHistory?: readonly number[];
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

/**
 * Minimum samples before a sparkline carries information. Two points is a
 * line segment, not a trend -- and with a zero range it renders as a lone
 * mid-height block that reads as a rendering artifact rather than data.
 */
const MIN_SPARKLINE_SAMPLES = 5;

/**
 * Eighth-block glyphs let the bar resolve sub-cell progress, so early
 * usage registers as movement instead of sitting at an empty bar until it
 * crosses a whole cell. The trailing partial cell is what makes a 40-wide
 * bar behave like a 320-step one.
 */
const PARTIAL_BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

function renderProgressBar(percentage: number, width: number): string {
  const clamped = Math.min(Math.max(percentage, 0), 1);
  const exact = width * clamped;
  const filled = Math.floor(exact);
  const partialIndex = Math.floor((exact - filled) * PARTIAL_BLOCKS.length);
  const partial = filled < width ? PARTIAL_BLOCKS[partialIndex] : '';
  const empty = Math.max(width - filled - (partial ? 1 : 0), 0);
  return '█'.repeat(filled) + partial + '░'.repeat(empty);
}

export const ContextVisualization: React.FC<ContextVisualizationProps> = ({
  usedTokens,
  maxTokens,
  modelName,
  terminalWidth,
  showDetails = true,
  tokenHistory,
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
            {tokenHistory && tokenHistory.length >= MIN_SPARKLINE_SAMPLES && (
              <Text color={theme.text.secondary}>
                {'  '}
                {renderSparkline(tokenHistory)}
              </Text>
            )}
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
          {tokenHistory && tokenHistory.length >= MIN_SPARKLINE_SAMPLES && (
            <Text color={theme.text.secondary}>
              {'  '}
              {renderSparkline(tokenHistory)}
            </Text>
          )}
        </Box>
      )}

      {percentage >= CONTEXT_USAGE_CRITICAL_THRESHOLD && (
        <Box paddingLeft={2}>
          <Text color={theme.status.error} bold>
            ⚠ Context window almost full! Consider using /compact
          </Text>
        </Box>
      )}

      {percentage >= 0.7 && percentage < CONTEXT_USAGE_CRITICAL_THRESHOLD && (
        <Box paddingLeft={2}>
          <Text color={theme.status.warning}>
            Context usage is getting high
          </Text>
        </Box>
      )}
    </Box>
  );
};

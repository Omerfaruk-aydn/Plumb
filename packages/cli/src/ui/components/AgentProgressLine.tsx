/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';

type ToolStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

interface ToolStep {
  name: string;
  status: ToolStatus;
  duration?: number;
  error?: string;
}

interface AgentProgressLineProps {
  agentName: string;
  agentType: string;
  currentStep?: string;
  steps?: ToolStep[];
  totalSteps?: number;
  completedSteps?: number;
  isComplete?: boolean;
  compact?: boolean;
}

const STATUS_SYMBOLS: Record<ToolStatus, { symbol: string; color: string }> = {
  pending: { symbol: '○', color: theme.text.secondary },
  running: { symbol: '◉', color: theme.ui.active },
  completed: { symbol: '✓', color: theme.status.success },
  failed: { symbol: '✗', color: theme.status.error },
  skipped: { symbol: '⊘', color: theme.text.secondary },
};

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export const AgentProgressLine: React.FC<AgentProgressLineProps> = ({
  agentName,
  agentType,
  currentStep,
  steps = [],
  totalSteps = 0,
  completedSteps = 0,
  isComplete = false,
  compact = false,
}) => {
  const [spinnerIndex, setSpinnerIndex] = useState(0);

  useEffect(() => {
    if (isComplete) return;

    const interval = setInterval(() => {
      setSpinnerIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);

    return () => clearInterval(interval);
  }, [isComplete]);

  const hasSteps = steps.length > 0 || totalSteps > 0;
  const effectiveTotal = totalSteps || steps.length;
  const effectiveCompleted =
    completedSteps || steps.filter((s) => s.status === 'completed').length;
  const isRunning = !isComplete && steps.some((s) => s.status === 'running');

  const spinner = SPINNER_FRAMES[spinnerIndex];

  if (compact) {
    return (
      <Box flexDirection="row" paddingX={1}>
        <Text color={isComplete ? theme.status.success : theme.ui.active}>
          {isComplete ? '✓' : spinner}
        </Text>
        <Text color={theme.text.primary}> {agentName}</Text>
        {currentStep && !isComplete && (
          <Text color={theme.text.secondary}> — {currentStep}</Text>
        )}
        {hasSteps && (
          <Text color={theme.text.secondary}>
            {' '}
            ({effectiveCompleted}/{effectiveTotal})
          </Text>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="row">
        <Text color={isComplete ? theme.status.success : theme.ui.active}>
          {isComplete ? '✓' : spinner}
        </Text>
        <Text color={theme.text.primary} bold>
          {' '}
          {agentName}
        </Text>
        <Text color={theme.text.secondary}> ({agentType})</Text>
        {hasSteps && (
          <Text color={theme.text.secondary}>
            {' '}
            [{effectiveCompleted}/{effectiveTotal}]
          </Text>
        )}
      </Box>

      {currentStep && !isComplete && (
        <Box paddingLeft={3}>
          <Text color={theme.text.secondary}>
            {isRunning ? '→' : ' '} {currentStep}
          </Text>
        </Box>
      )}

      {steps.length > 0 && (
        <Box flexDirection="column" paddingLeft={3}>
          {steps.map((step, index) => {
            const statusInfo = STATUS_SYMBOLS[step.status];
            return (
              <Box key={index} flexDirection="row">
                <Text color={statusInfo.color}>
                  {step.status === 'running' ? spinner : statusInfo.symbol}
                </Text>
                <Text
                  color={
                    step.status === 'running'
                      ? theme.text.primary
                      : step.status === 'completed'
                        ? theme.text.secondary
                        : statusInfo.color
                  }
                >
                  {' '}
                  {step.name}
                </Text>
                {step.duration !== undefined && step.status === 'completed' && (
                  <Text color={theme.text.secondary} dimColor>
                    {' '}
                    ({formatDuration(step.duration)})
                  </Text>
                )}
                {step.error && step.status === 'failed' && (
                  <Text color={theme.status.error}> — {step.error}</Text>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
};

interface SimpleProgressLineProps {
  current: number;
  total: number;
  label: string;
  showBar?: boolean;
  barWidth?: number;
}

export const SimpleProgressLine: React.FC<SimpleProgressLineProps> = ({
  current,
  total,
  label,
  showBar = true,
  barWidth = 20,
}) => {
  const percentage = total > 0 ? current / total : 0;
  const filled = Math.round(barWidth * percentage);
  const empty = barWidth - filled;

  return (
    <Box flexDirection="row" paddingX={1}>
      <Text color={theme.text.secondary}>{label}</Text>
      {showBar && (
        <>
          <Text color={theme.status.success}> {'█'.repeat(filled)}</Text>
          <Text color={theme.text.secondary}>{'░'.repeat(empty)}</Text>
        </>
      )}
      <Text color={theme.text.secondary}>
        {' '}
        ({current}/{total})
      </Text>
    </Box>
  );
};

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';

type AgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

interface AgentInfo {
  id: string;
  name: string;
  type: string;
  status: AgentStatus;
  currentTask?: string;
  progress?: number;
  progressTotal?: number;
  startTime?: string;
}

interface MultiAgentStatusProps {
  agents: AgentInfo[];
  terminalWidth: number;
  compact?: boolean;
  label?: string;
}

const STATUS_ICONS: Record<AgentStatus, { icon: string; color: string }> = {
  pending: { icon: '◌', color: theme.text.secondary },
  running: { icon: '●', color: theme.ui.active },
  completed: { icon: '✓', color: theme.status.success },
  failed: { icon: '✗', color: theme.status.error },
  cancelled: { icon: '⊘', color: theme.text.secondary },
};

const AGENT_TYPE_ICONS: Record<string, string> = {
  coder: ' ',
  reviewer: ' ',
  researcher: ' ',
  tester: ' ',
  general: ' ',
};

function formatDuration(startTime?: string): string {
  if (!startTime) return '';
  const start = new Date(startTime);
  const now = new Date();
  const diffSeconds = Math.floor((now.getTime() - start.getTime()) / 1000);

  if (diffSeconds < 60) return `${diffSeconds}s`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  const remainingSeconds = diffSeconds % 60;
  return `${diffMinutes}m ${remainingSeconds}s`;
}

function renderProgressBar(
  progress: number,
  total: number,
  width: number,
): string {
  const percentage = total > 0 ? progress / total : 0;
  const filled = Math.round(width * percentage);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export const MultiAgentStatus: React.FC<MultiAgentStatusProps> = ({
  agents,
  terminalWidth,
  compact = false,
  label = 'Multi-Agent Status',
}) => {
  if (agents.length === 0) {
    return null;
  }

  const isNarrow = terminalWidth < 60;
  const useCompact = compact || isNarrow;

  const runningCount = agents.filter((a) => a.status === 'running').length;
  const completedCount = agents.filter((a) => a.status === 'completed').length;
  const failedCount = agents.filter((a) => a.status === 'failed').length;

  if (useCompact) {
    return (
      <Box flexDirection="row" paddingX={1}>
        <Text color={theme.text.accent} bold>
          {' '}
        </Text>
        <Text color={theme.text.secondary}>Agents: </Text>
        {runningCount > 0 && (
          <Text color={theme.ui.active}>{runningCount} running</Text>
        )}
        {completedCount > 0 && (
          <Text color={theme.status.success}>
            {runningCount > 0 ? ' · ' : ''}
            {completedCount} done
          </Text>
        )}
        {failedCount > 0 && (
          <Text color={theme.status.error}>
            {runningCount > 0 || completedCount > 0 ? ' · ' : ''}
            {failedCount} failed
          </Text>
        )}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.ui.active}
      paddingX={1}
      marginY={1}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text color={theme.text.accent} bold>
            {' '}
          </Text>
          <Text color={theme.text.accent} bold>
            {label}
          </Text>
        </Box>
        <Text color={theme.text.secondary}>
          {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </Text>
      </Box>

      <Box flexDirection="column" paddingTop={1}>
        {agents.map((agent) => {
          const statusInfo = STATUS_ICONS[agent.status];
          const typeIcon = AGENT_TYPE_ICONS[agent.type] || ' ';
          const duration = formatDuration(agent.startTime);

          return (
            <Box key={agent.id} flexDirection="column" paddingLeft={1}>
              <Box flexDirection="row">
                <Text color={statusInfo.color}>{statusInfo.icon} </Text>
                <Text>{typeIcon}</Text>
                <Text color={theme.text.primary} bold>
                  {agent.name}
                </Text>
                <Text color={theme.text.secondary}> ({agent.type})</Text>
                {duration && (
                  <Text color={theme.text.secondary}> · {duration}</Text>
                )}
              </Box>

              {agent.currentTask && (
                <Box paddingLeft={4}>
                  <Text color={theme.text.secondary}>{agent.currentTask}</Text>
                </Box>
              )}

              {agent.progress !== undefined &&
                agent.progressTotal !== undefined && (
                  <Box paddingLeft={4} flexDirection="row">
                    <Text color={statusInfo.color}>
                      {renderProgressBar(
                        agent.progress,
                        agent.progressTotal,
                        20,
                      )}
                    </Text>
                    <Text color={theme.text.secondary}>
                      {' '}
                      {agent.progress}/{agent.progressTotal}
                    </Text>
                  </Box>
                )}
            </Box>
          );
        })}
      </Box>

      {(runningCount > 0 || failedCount > 0) && (
        <Box
          flexDirection="row"
          justifyContent="center"
          borderTop
          borderColor={theme.border.default}
          paddingTop={1}
        >
          {runningCount > 0 && (
            <Text color={theme.ui.active}>● {runningCount} running</Text>
          )}
          {failedCount > 0 && (
            <Text color={theme.status.error}>
              {runningCount > 0 ? ' · ' : ''}✗ {failedCount} failed
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};

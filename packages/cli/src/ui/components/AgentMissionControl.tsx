/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState } from 'react';
import { Box, Text, useIsScreenReaderEnabled } from 'ink';
import { theme } from '../semantic-colors.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { SubagentState } from '@plumb/core';
import type { AgentRun } from '../utils/sessionAgentActivity.js';

export interface AgentMissionControlProps {
  runs: readonly AgentRun[];
  onClose: () => void;
  terminalWidth: number;
}

const AGENT_LIST_WIDTH = 26;

const STATE_ICON: Record<SubagentState, { symbol: string; color: string }> = {
  [SubagentState.RUNNING]: { symbol: '!', color: theme.ui.active },
  [SubagentState.COMPLETED]: { symbol: '✓', color: theme.status.success },
  [SubagentState.CANCELLED]: { symbol: 'ℹ', color: theme.status.warning },
  [SubagentState.ERROR]: { symbol: '✗', color: theme.status.error },
};

function stateLabel(state: SubagentState): string {
  switch (state) {
    case SubagentState.RUNNING:
      return 'running';
    case SubagentState.COMPLETED:
      return 'completed';
    case SubagentState.CANCELLED:
      return 'cancelled';
    case SubagentState.ERROR:
      return 'error';
    default:
      return state;
  }
}

export const AgentMissionControl: React.FC<AgentMissionControlProps> = ({
  runs,
  onClose,
  terminalWidth,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isScreenReaderEnabled = useIsScreenReaderEnabled();

  const clampedIndex = Math.min(selectedIndex, Math.max(0, runs.length - 1));
  const selected = runs[clampedIndex];

  useKeypress(
    (key) => {
      if (key.name === 'escape' || (key.sequence === 'q' && !key.ctrl)) {
        onClose();
        return true;
      }
      if (key.name === 'up' || key.name === 'k') {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return true;
      }
      if (key.name === 'down' || key.name === 'j') {
        setSelectedIndex((i) => Math.min(runs.length - 1, i + 1));
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  const runningCount = runs.filter(
    (r) => r.state === SubagentState.RUNNING,
  ).length;

  if (isScreenReaderEnabled) {
    return (
      <Box flexDirection="column">
        <Text>
          Agent mission control. {runs.length} agent
          {runs.length === 1 ? '' : 's'} this session, {runningCount} running.
        </Text>
        {runs.length === 0 ? (
          <Text>No agents have run yet.</Text>
        ) : (
          <>
            <Text>
              Selected: {selected.agentName} ({stateLabel(selected.state)})
            </Text>
            {selected.activity.map((activity) => (
              <Text key={activity.id}>
                {activity.type}: {activity.content} ({activity.status})
              </Text>
            ))}
          </>
        )}
      </Box>
    );
  }

  if (runs.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.text.accent} bold>
          Agent Mission Control
        </Text>
        <Box marginTop={1}>
          <Text dimColor>No agents have run yet this session.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc/q to close</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={theme.text.accent} bold>
        Agent Mission Control — {runs.length} agent
        {runs.length === 1 ? '' : 's'} · {runningCount} running
      </Text>
      <Box marginTop={1} flexDirection="row">
        <Box
          flexDirection="column"
          width={AGENT_LIST_WIDTH}
          flexShrink={0}
          marginRight={2}
        >
          {runs.map((run, i) => {
            const isSelected = i === clampedIndex;
            const icon = STATE_ICON[run.state];
            return (
              <Box key={run.key}>
                <Text color={isSelected ? theme.text.accent : undefined}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                <Text color={icon.color}>{icon.symbol} </Text>
                <Text
                  bold={isSelected}
                  color={isSelected ? theme.text.primary : undefined}
                  wrap="truncate-end"
                >
                  {run.agentName}
                </Text>
              </Box>
            );
          })}
        </Box>
        <Box
          flexDirection="column"
          flexGrow={1}
          width={Math.max(20, terminalWidth - AGENT_LIST_WIDTH - 6)}
        >
          <Text bold color={theme.text.primary}>
            {selected.agentName}{' '}
            <Text color={STATE_ICON[selected.state].color}>
              ({stateLabel(selected.state)})
            </Text>
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {selected.activity.length === 0 ? (
              <Text dimColor>No activity recorded yet.</Text>
            ) : (
              selected.activity.map((activity) => (
                <Box key={activity.id}>
                  <Text color={theme.text.secondary} wrap="truncate-end">
                    {activity.type === 'thought' ? '🧠 ' : '🛠️ '}
                    {activity.displayName || activity.content}
                    {activity.status === SubagentState.RUNNING &&
                      ' (running...)'}
                    {activity.status === SubagentState.ERROR && ' (error)'}
                  </Text>
                </Box>
              ))
            )}
          </Box>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ select agent · Esc/q close · read-only</Text>
      </Box>
    </Box>
  );
};

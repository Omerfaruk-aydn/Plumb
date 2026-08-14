/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F22 (PLUMB-UI-DEVRIM-PROMPT.md): `/stats --live` full-screen dashboard.
 * All numbers come straight from the same `useSessionStats()` source
 * ModelStatsDisplay/ToolStatsDisplay already render inline -- this just
 * lays them out live, side by side, plus a token sparkline sampled every
 * 2s from the F5 sparkline renderer.
 */
import type React from 'react';
import { useEffect, useState } from 'react';
import { Box, Text, useIsScreenReaderEnabled } from 'ink';
import { theme } from '../semantic-colors.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { useSessionStats } from '../contexts/SessionContext.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { renderSparkline } from '../utils/sparkline.js';
import { formatDuration } from '../utils/formatters.js';

export interface StatsDashboardProps {
  onClose: () => void;
}

const REFRESH_INTERVAL_MS = 2000;
const MAX_SPARKLINE_SAMPLES = 40;
const NARROW_LAYOUT_THRESHOLD = 100;
const TOP_TOOLS_COUNT = 5;

function totalTokensAcrossModels(
  models: Record<string, { tokens: { total: number } }>,
): number {
  return Object.values(models).reduce((sum, m) => sum + m.tokens.total, 0);
}

export const StatsDashboard: React.FC<StatsDashboardProps> = ({ onClose }) => {
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  const { stats } = useSessionStats();
  const { columns: terminalWidth, rows: terminalHeight } = useTerminalSize();
  const [now, setNow] = useState(() => Date.now());
  const [tokenHistory, setTokenHistory] = useState<number[]>(() => [
    totalTokensAcrossModels(stats.metrics.models),
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
      setTokenHistory((prev) => {
        const next = [...prev, totalTokensAcrossModels(stats.metrics.models)];
        return next.length > MAX_SPARKLINE_SAMPLES
          ? next.slice(next.length - MAX_SPARKLINE_SAMPLES)
          : next;
      });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [stats.metrics.models]);

  useKeypress(
    (key) => {
      if (key.name === 'escape' || (key.sequence === 'q' && !key.ctrl)) {
        onClose();
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  const modelEntries = Object.entries(stats.metrics.models);
  const toolEntries = Object.entries(stats.metrics.tools.byName)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, TOP_TOOLS_COUNT);
  const totalTokens = totalTokensAcrossModels(stats.metrics.models);
  const durationMs = now - stats.sessionStartTime.getTime();

  if (isScreenReaderEnabled) {
    return (
      <Box flexDirection="column">
        <Text>
          Live session stats. Duration {formatDuration(durationMs)}, total
          tokens {totalTokens}.
        </Text>
        <Text>
          {modelEntries.length} model{modelEntries.length === 1 ? '' : 's'} used
          this session.
        </Text>
        {modelEntries.map(([name, m]) => (
          <Text key={name}>
            {name}: {m.api.totalRequests} requests, {m.tokens.total} tokens
          </Text>
        ))}
        <Text>
          {stats.metrics.tools.totalCalls} tool call
          {stats.metrics.tools.totalCalls === 1 ? '' : 's'} total.
        </Text>
        {toolEntries.map(([name, t]) => (
          <Text key={name}>
            {name}: {t.count} calls, {t.success} succeeded, {t.fail} failed
          </Text>
        ))}
      </Box>
    );
  }

  const narrow = terminalWidth < NARROW_LAYOUT_THRESHOLD;

  const overviewPanel = (
    <Box flexDirection="column" paddingX={1} width={narrow ? undefined : '50%'}>
      <Text color={theme.text.accent} bold>
        Overview
      </Text>
      <Text>Duration: {formatDuration(durationMs)}</Text>
      <Text>Total tokens: {totalTokens}</Text>
      <Text dimColor>Cost: not tracked</Text>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          Token activity (last {tokenHistory.length} samples)
        </Text>
        {tokenHistory.length < 2 ? (
          <Text dimColor>Collecting samples…</Text>
        ) : (
          <Text>{renderSparkline(tokenHistory)}</Text>
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Models</Text>
        {modelEntries.length === 0 ? (
          <Text dimColor>No model activity yet.</Text>
        ) : (
          modelEntries.map(([name, m]) => (
            <Text key={name}>
              {name}: {m.api.totalRequests} req · {m.tokens.total} tok
            </Text>
          ))
        )}
      </Box>
    </Box>
  );

  const toolsPanel = (
    <Box flexDirection="column" paddingX={1} width={narrow ? undefined : '50%'}>
      <Text color={theme.text.accent} bold>
        Top tools
      </Text>
      {toolEntries.length === 0 ? (
        <Text dimColor>No tool calls yet.</Text>
      ) : (
        toolEntries.map(([name, t]) => (
          <Text key={name}>
            {name}: {t.count} calls ({t.success} ok / {t.fail} failed)
          </Text>
        ))
      )}
    </Box>
  );

  return (
    <Box
      flexDirection="column"
      width={terminalWidth}
      height={terminalHeight}
      paddingX={1}
    >
      <Text color={theme.text.accent} bold>
        PLUMB Live Stats
      </Text>
      <Box flexDirection={narrow ? 'column' : 'row'} marginTop={1}>
        {overviewPanel}
        {toolsPanel}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>q/Esc to close · refreshes every 2s</Text>
      </Box>
    </Box>
  );
};

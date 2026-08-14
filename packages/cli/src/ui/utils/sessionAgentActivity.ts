/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { isSubagentProgress, SubagentState } from '@plumb/core';
import type { SubagentActivityItem } from '@plumb/core';
import type { HistoryItem } from '../types.js';

export interface AgentRun {
  /** Stable key for list rendering / selection. */
  key: string;
  agentName: string;
  state: SubagentState;
  activity: SubagentActivityItem[];
}

export function collectSessionAgentRuns(history: HistoryItem[]): AgentRun[] {
  const runs: AgentRun[] = [];

  for (const item of history) {
    if (item.type === 'subagent') {
      runs.push({
        key: `subagent-${item.id}`,
        agentName: item.agentName,
        state: SubagentState.COMPLETED,
        activity: item.history,
      });
      continue;
    }
    if (item.type !== 'tool_group') continue;
    for (const tool of item.tools) {
      const progress = tool.resultDisplay;
      if (!isSubagentProgress(progress)) continue;
      runs.push({
        key: tool.callId,
        agentName: progress.agentName,
        state: progress.state ?? SubagentState.RUNNING,
        activity: tool.subagentHistory ?? progress.recentActivity,
      });
    }
  }

  return runs;
}

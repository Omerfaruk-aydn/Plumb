/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F8 (PLUMB-UI-DEVRIM-PROMPT.md) data source. Unifies the two places
 * subagent activity already lives in `history` -- never invents new
 * tracking state:
 *  - in-progress Task tool calls, whose `resultDisplay` carries live
 *    `SubagentProgress` (the same object SubagentGroupDisplay renders
 *    inline in the chat), and
 *  - finished runs recorded as a standalone `HistoryItemSubagent`
 *    (the same object SubagentHistoryMessage renders).
 * Because this reads straight from `history` on every render, a run that
 * is still executing updates live with no interval/timer of its own.
 */
import { isSubagentProgress, SubagentState } from '@google/gemini-cli-core';
import type { SubagentActivityItem } from '@google/gemini-cli-core';
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

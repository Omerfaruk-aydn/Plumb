/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { SubagentState } from '@plumb/core';
import { collectSessionAgentRuns } from './sessionAgentActivity.js';
import type { HistoryItem, IndividualToolCallDisplay } from '../types.js';
import { CoreToolCallStatus } from '../types.js';

let nextId = 1;
function historyItem<T extends object>(item: T): HistoryItem {
  return { id: nextId++, ...item } as unknown as HistoryItem;
}

function toolCall(
  overrides: Partial<IndividualToolCallDisplay>,
): IndividualToolCallDisplay {
  return {
    callId: 'call-1',
    name: 'run_agent',
    description: 'agent',
    status: CoreToolCallStatus.Executing,
    resultDisplay: undefined,
    confirmationDetails: undefined,
    ...overrides,
  };
}

describe('collectSessionAgentRuns', () => {
  it('returns an empty list when there is no history', () => {
    expect(collectSessionAgentRuns([])).toEqual([]);
  });

  it('ignores tool calls whose resultDisplay is not subagent progress', () => {
    const history: HistoryItem[] = [
      historyItem({
        type: 'tool_group',
        tools: [toolCall({ resultDisplay: 'plain text output' })],
      }),
    ];
    expect(collectSessionAgentRuns(history)).toEqual([]);
  });

  it('collects a running agent from live SubagentProgress', () => {
    const history: HistoryItem[] = [
      historyItem({
        type: 'tool_group',
        tools: [
          toolCall({
            callId: 'call-1',
            resultDisplay: {
              isSubagentProgress: true,
              agentName: 'researcher',
              state: SubagentState.RUNNING,
              recentActivity: [
                {
                  id: 'a1',
                  type: 'thought',
                  content: 'thinking...',
                  status: SubagentState.RUNNING,
                },
              ],
            },
          }),
        ],
      }),
    ];

    const runs = collectSessionAgentRuns(history);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      key: 'call-1',
      agentName: 'researcher',
      state: SubagentState.RUNNING,
    });
    expect(runs[0].activity).toHaveLength(1);
  });

  it('prefers the tool call subagentHistory override over recentActivity', () => {
    const history: HistoryItem[] = [
      historyItem({
        type: 'tool_group',
        tools: [
          toolCall({
            callId: 'call-1',
            subagentHistory: [
              {
                id: 'full-1',
                type: 'tool_call',
                content: 'full history item',
                status: SubagentState.COMPLETED,
              },
            ],
            resultDisplay: {
              isSubagentProgress: true,
              agentName: 'researcher',
              state: SubagentState.COMPLETED,
              recentActivity: [
                {
                  id: 'recent-1',
                  type: 'thought',
                  content: 'truncated recent activity',
                  status: SubagentState.COMPLETED,
                },
              ],
            },
          }),
        ],
      }),
    ];

    const runs = collectSessionAgentRuns(history);
    expect(runs[0].activity).toEqual([
      {
        id: 'full-1',
        type: 'tool_call',
        content: 'full history item',
        status: SubagentState.COMPLETED,
      },
    ]);
  });

  it('collects a finished agent from a standalone HistoryItemSubagent', () => {
    const history: HistoryItem[] = [
      historyItem({
        type: 'subagent',
        agentName: 'reviewer',
        history: [
          {
            id: 'h1',
            type: 'tool_call',
            content: 'read file',
            status: SubagentState.COMPLETED,
          },
        ],
      }),
    ];

    const runs = collectSessionAgentRuns(history);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      agentName: 'reviewer',
      state: SubagentState.COMPLETED,
    });
    expect(runs[0].key).toMatch(/^subagent-/);
  });

  it('collects runs across mixed history in order', () => {
    const history: HistoryItem[] = [
      historyItem({
        type: 'tool_group',
        tools: [
          toolCall({
            callId: 'call-1',
            resultDisplay: {
              isSubagentProgress: true,
              agentName: 'first',
              state: SubagentState.RUNNING,
              recentActivity: [],
            },
          }),
        ],
      }),
      historyItem({
        type: 'subagent',
        agentName: 'second',
        history: [],
      }),
    ];

    const runs = collectSessionAgentRuns(history);
    expect(runs.map((r) => r.agentName)).toEqual(['first', 'second']);
  });
});

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getLastTurnToolCallIds } from './historyUtils.js';
import { toolGroupExpansionId } from './toolGroupSummary.js';
import { CoreToolCallStatus } from '../types.js';
import type { HistoryItem, HistoryItemWithoutId } from '../types.js';

function toolGroupItem(id: number, callIds: string[]): HistoryItem {
  return {
    id,
    type: 'tool_group',
    tools: callIds.map((callId) => ({
      callId,
      name: 'read_file',
      description: '',
      resultDisplay: undefined,
      status: CoreToolCallStatus.Success,
      confirmationDetails: undefined,
    })),
  } as HistoryItem;
}

function userItem(id: number): HistoryItem {
  return { id, type: 'user', text: 'hi' } as HistoryItem;
}

describe('getLastTurnToolCallIds', () => {
  it('collects individual tool call ids and the group expansion id for tool groups after the last user prompt', () => {
    const history: HistoryItem[] = [
      userItem(1),
      toolGroupItem(2, ['call-a', 'call-b']),
    ];
    const ids = getLastTurnToolCallIds(history, []);
    expect(ids).toContain('call-a');
    expect(ids).toContain('call-b');
    expect(ids).toContain(toolGroupExpansionId(2));
  });

  it('ignores tool groups before the last user prompt', () => {
    const history: HistoryItem[] = [
      toolGroupItem(1, ['old-call']),
      userItem(2),
      toolGroupItem(3, ['new-call']),
    ];
    const ids = getLastTurnToolCallIds(history, []);
    expect(ids).not.toContain('old-call');
    expect(ids).not.toContain(toolGroupExpansionId(1));
    expect(ids).toContain('new-call');
    expect(ids).toContain(toolGroupExpansionId(3));
  });

  it('collects ids from pending tool groups too, without a group expansion id (they have no history id yet)', () => {
    const pending: HistoryItemWithoutId[] = [
      {
        type: 'tool_group',
        tools: [
          {
            callId: 'pending-call',
            name: 'read_file',
            description: '',
            resultDisplay: undefined,
            status: CoreToolCallStatus.Executing,
            confirmationDetails: undefined,
          },
        ],
      } as HistoryItemWithoutId,
    ];
    const ids = getLastTurnToolCallIds([], pending);
    expect(ids).toContain('pending-call');
  });
});

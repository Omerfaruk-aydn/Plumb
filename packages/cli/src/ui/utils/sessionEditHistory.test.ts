/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { collectSessionEdits } from './sessionEditHistory.js';
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
    name: 'edit_file',
    description: 'edit',
    status: CoreToolCallStatus.Success,
    resultDisplay: undefined,
    confirmationDetails: undefined,
    ...overrides,
  };
}

describe('collectSessionEdits', () => {
  it('returns an empty list when there is no history', () => {
    expect(collectSessionEdits([])).toEqual([]);
  });

  it('ignores non tool_group history items', () => {
    const history: HistoryItem[] = [historyItem({ type: 'user', text: 'hi' })];
    expect(collectSessionEdits(history)).toEqual([]);
  });

  it('ignores tool calls without a FileDiff resultDisplay', () => {
    const history: HistoryItem[] = [
      historyItem({
        type: 'tool_group',
        tools: [toolCall({ resultDisplay: 'just some text' })],
      }),
    ];
    expect(collectSessionEdits(history)).toEqual([]);
  });

  it('ignores tool calls that did not succeed', () => {
    const history: HistoryItem[] = [
      historyItem({
        type: 'tool_group',
        tools: [
          toolCall({
            status: CoreToolCallStatus.Error,
            resultDisplay: {
              fileName: 'a.ts',
              filePath: '/repo/a.ts',
              fileDiff: 'diff',
              originalContent: '',
              newContent: 'x',
              diffStat: {
                model_added_lines: 1,
                model_removed_lines: 0,
                model_added_chars: 1,
                model_removed_chars: 0,
                user_added_lines: 0,
                user_removed_lines: 0,
                user_added_chars: 0,
                user_removed_chars: 0,
              },
            },
          }),
        ],
      }),
    ];
    expect(collectSessionEdits(history)).toEqual([]);
  });

  it('collects successful file edits in order across multiple tool groups', () => {
    const diffStat = {
      model_added_lines: 3,
      model_removed_lines: 1,
      model_added_chars: 30,
      model_removed_chars: 10,
      user_added_lines: 0,
      user_removed_lines: 0,
      user_added_chars: 0,
      user_removed_chars: 0,
    };
    const history: HistoryItem[] = [
      historyItem({
        type: 'tool_group',
        tools: [
          toolCall({
            callId: 'call-1',
            resultDisplay: {
              fileName: 'a.ts',
              filePath: '/repo/a.ts',
              fileDiff: 'diff-a',
              originalContent: '',
              newContent: 'x',
              diffStat,
              isNewFile: false,
            },
          }),
        ],
      }),
      historyItem({
        type: 'tool_group',
        tools: [
          toolCall({
            callId: 'call-2',
            resultDisplay: {
              fileName: 'b.ts',
              filePath: '/repo/b.ts',
              fileDiff: 'diff-b',
              originalContent: null,
              newContent: 'y',
              diffStat,
              isNewFile: true,
            },
          }),
        ],
      }),
    ];

    const edits = collectSessionEdits(history);
    expect(edits).toHaveLength(2);
    expect(edits[0]).toMatchObject({
      key: 'call-1',
      fileName: 'a.ts',
      fileDiff: 'diff-a',
      isNewFile: false,
      addedLines: 3,
      removedLines: 1,
    });
    expect(edits[1]).toMatchObject({
      key: 'call-2',
      fileName: 'b.ts',
      fileDiff: 'diff-b',
      isNewFile: true,
    });
  });
});

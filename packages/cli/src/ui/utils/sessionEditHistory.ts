/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { isFileDiff, computeModelAddedAndRemovedLines } from '@plumb/core';
import type { HistoryItem } from '../types.js';
import { CoreToolCallStatus } from '../types.js';

export interface SessionEdit {
  /** Stable key for list rendering / selection. */
  key: string;
  fileName: string;
  filePath: string;
  fileDiff: string;
  isNewFile: boolean;
  addedLines: number;
  removedLines: number;
}

export function collectSessionEdits(history: HistoryItem[]): SessionEdit[] {
  const edits: SessionEdit[] = [];

  for (const item of history) {
    if (item.type !== 'tool_group') continue;
    for (const tool of item.tools) {
      if (tool.status !== CoreToolCallStatus.Success) continue;
      const diff = tool.resultDisplay;
      if (!isFileDiff(diff)) continue;
      const { addedLines, removedLines } = computeModelAddedAndRemovedLines(
        diff.diffStat,
      );
      edits.push({
        key: tool.callId,
        fileName: diff.fileName,
        filePath: diff.filePath,
        fileDiff: diff.fileDiff,
        isNewFile: diff.isNewFile ?? false,
        addedLines,
        removedLines,
      });
    }
  }

  return edits;
}

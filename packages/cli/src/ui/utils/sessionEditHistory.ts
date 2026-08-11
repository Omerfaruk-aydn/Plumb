/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F7 (PLUMB-UI-DEVRIM-PROMPT.md) data source. Reads already-applied edit
 * diffs straight out of the live UI history -- never regenerates a diff.
 * Each completed Edit/WriteFile-style tool call already carries its diff in
 * `resultDisplay` (the same object DenseToolMessage renders); this just
 * collects those across the whole session into a flat, ordered list.
 */
import {
  isFileDiff,
  computeModelAddedAndRemovedLines,
} from '@google/gemini-cli-core';
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

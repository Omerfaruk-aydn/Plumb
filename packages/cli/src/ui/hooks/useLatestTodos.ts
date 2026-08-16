/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import type { TodoList } from '@plumb/core';
import { useUIState } from '../contexts/UIStateContext.js';
import type { HistoryItemToolGroup } from '../types.js';

/**
 * The most recent todo list any tool wrote this session, or null.
 *
 * Shared by the expanded checklist and the pill strip so the two can never
 * disagree about how far along the plan is -- two independent scans of the
 * same history would be two chances to drift.
 */
export function useLatestTodos(): TodoList | null {
  const uiState = useUIState();

  return useMemo(() => {
    for (let i = uiState.history.length - 1; i >= 0; i--) {
      const entry = uiState.history[i];
      if (entry.type !== 'tool_group') {
        continue;
      }
      const toolGroup = entry as HistoryItemToolGroup;
      for (const tool of toolGroup.tools) {
        if (
          typeof tool.resultDisplay !== 'object' ||
          tool.resultDisplay === null ||
          !('todos' in tool.resultDisplay)
        ) {
          continue;
        }
        return tool.resultDisplay;
      }
    }
    return null;
  }, [uiState.history]);
}

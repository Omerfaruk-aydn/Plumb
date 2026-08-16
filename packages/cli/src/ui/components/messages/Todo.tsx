/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo } from 'react';
import { useUIState } from '../../contexts/UIStateContext.js';
import { useLatestTodos } from '../../hooks/useLatestTodos.js';
import { Checklist } from '../Checklist.js';
import type { ChecklistItemData } from '../ChecklistItem.js';
import { formatCommand } from '../../key/keybindingUtils.js';
import { Command } from '../../key/keyBindings.js';

export const TodoTray: React.FC = () => {
  const uiState = useUIState();
  const todos = useLatestTodos();

  const checklistItems: ChecklistItemData[] = useMemo(() => {
    if (!todos || !todos.todos) {
      return [];
    }
    return todos.todos.map((todo) => ({
      status: todo.status,
      label: todo.description,
    }));
  }, [todos]);

  if (!todos || !todos.todos) {
    return null;
  }

  return (
    <Checklist
      title="Todo"
      items={checklistItems}
      isExpanded={uiState.showFullTodos}
      toggleHint={`${formatCommand(Command.SHOW_FULL_TODOS)} to toggle`}
    />
  );
};

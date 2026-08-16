/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo } from 'react';
import { useUIState } from '../../contexts/UIStateContext.js';
import { useLatestTodos } from '../../hooks/useLatestTodos.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { isNarrowWidth } from '../../utils/isNarrowWidth.js';
import { PillStrip } from './PillStrip.js';
import { buildPills } from './pillSources.js';

/**
 * The composer's in-flight summary row: how far through the todo list the
 * agent is, and how many messages are waiting behind the current turn.
 *
 * This replaces the stacked queued-message list and the collapsed todo
 * heading, which between them spent up to six rows above the prompt saying
 * what fits on one. The expanded checklist is untouched -- pressing the
 * toggle still opens the full list, and the pill stands down while it is
 * open rather than repeating its heading.
 */
export const ComposerPills: React.FC = () => {
  const uiState = useUIState();
  const todos = useLatestTodos();
  const { columns } = useTerminalSize();

  const marginLeft = isNarrowWidth(columns) ? 0 : 1;

  const pills = useMemo(
    () =>
      buildPills({
        todos,
        messageQueue: uiState.messageQueue,
        todosExpanded: uiState.showFullTodos,
      }),
    [todos, uiState.messageQueue, uiState.showFullTodos],
  );

  return (
    <PillStrip
      pills={pills}
      availableWidth={Math.max(columns - marginLeft, 0)}
      marginLeft={marginLeft}
    />
  );
};

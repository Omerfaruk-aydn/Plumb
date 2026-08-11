/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F11 (PLUMB-UI-DEVRIM-PROMPT.md) "next-action chips", scoped to a static
 * one-line hint rather than clickable/selectable chips: a real chip
 * widget would need its own keyboard focus mode, which risks stealing
 * keystrokes from the composer right after a response -- exactly when the
 * user is most likely about to type. Instead this surfaces the same
 * shortcuts F7 (alt+r, diff review) and F8 (alt+a, agent mission control)
 * already bound, scoped to just the turn that finished (via
 * getLastTurnHistoryItems), so it reads as a contextual suggestion
 * without adding a new interaction surface.
 */
import type React from 'react';
import { Text } from 'ink';
import { theme } from '../semantic-colors.js';
import type { SessionEdit } from '../utils/sessionEditHistory.js';
import type { AgentRun } from '../utils/sessionAgentActivity.js';

export interface SuggestionChipsProps {
  edits: readonly SessionEdit[];
  agentRuns: readonly AgentRun[];
}

export const SuggestionChips: React.FC<SuggestionChipsProps> = ({
  edits,
  agentRuns,
}) => {
  const parts: string[] = [];
  if (edits.length > 0) {
    parts.push(
      `${edits.length} file${edits.length === 1 ? '' : 's'} changed — alt+r to review`,
    );
  }
  if (agentRuns.length > 0) {
    parts.push(
      `${agentRuns.length} agent${agentRuns.length === 1 ? '' : 's'} ran — alt+a for mission control`,
    );
  }

  if (parts.length === 0) {
    return null;
  }

  return (
    <Text color={theme.text.secondary} wrap="truncate-end">
      {parts.join('  ·  ')}
    </Text>
  );
};

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
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

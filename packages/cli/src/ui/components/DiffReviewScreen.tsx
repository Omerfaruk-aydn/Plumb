/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo, useState } from 'react';
import { Box, Text, useIsScreenReaderEnabled } from 'ink';
import { theme } from '../semantic-colors.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { DiffRenderer } from './messages/DiffRenderer.js';
import type { SessionEdit } from '../utils/sessionEditHistory.js';

export interface DiffReviewScreenProps {
  edits: readonly SessionEdit[];
  onClose: () => void;
  terminalWidth: number;
  terminalHeight: number;
}

const FILE_LIST_WIDTH = 30;

function statLine(edit: SessionEdit): string {
  const parts: string[] = [];
  if (edit.isNewFile) parts.push('new');
  if (edit.addedLines > 0) parts.push(`+${edit.addedLines}`);
  if (edit.removedLines > 0) parts.push(`-${edit.removedLines}`);
  return parts.join(' ') || '(no changes)';
}

export const DiffReviewScreen: React.FC<DiffReviewScreenProps> = ({
  edits,
  onClose,
  terminalWidth,
  terminalHeight,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isScreenReaderEnabled = useIsScreenReaderEnabled();

  const clampedIndex = Math.min(selectedIndex, Math.max(0, edits.length - 1));
  const selected = edits[clampedIndex];

  useKeypress(
    (key) => {
      if (key.name === 'escape' || (key.sequence === 'q' && !key.ctrl)) {
        onClose();
        return true;
      }
      if (key.name === 'up' || key.name === 'k') {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return true;
      }
      if (key.name === 'down' || key.name === 'j') {
        setSelectedIndex((i) => Math.min(edits.length - 1, i + 1));
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  const availableTerminalHeight = useMemo(
    () => Math.max(5, terminalHeight - 6),
    [terminalHeight],
  );

  if (isScreenReaderEnabled) {
    return (
      <Box flexDirection="column">
        <Text>
          Diff review. {edits.length} file
          {edits.length === 1 ? '' : 's'} edited this session.
        </Text>
        {edits.length === 0 ? (
          <Text>No edits yet.</Text>
        ) : (
          <>
            <Text>
              Selected: {selected.fileName} ({statLine(selected)})
            </Text>
            <Text>{selected.fileDiff}</Text>
          </>
        )}
      </Box>
    );
  }

  if (edits.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.text.accent} bold>
          Diff Review
        </Text>
        <Box marginTop={1}>
          <Text dimColor>No file edits have been made this session yet.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc/q to close</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={theme.text.accent} bold>
        Diff Review — {edits.length} file{edits.length === 1 ? '' : 's'} edited
        this session
      </Text>
      <Box marginTop={1} flexDirection="row">
        <Box
          flexDirection="column"
          width={FILE_LIST_WIDTH}
          flexShrink={0}
          marginRight={2}
        >
          {edits.map((edit, i) => {
            const isSelected = i === clampedIndex;
            return (
              <Box key={edit.key}>
                <Text color={isSelected ? theme.text.accent : undefined}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                <Box flexDirection="column">
                  <Text
                    bold={isSelected}
                    color={isSelected ? theme.text.primary : undefined}
                    wrap="truncate-end"
                  >
                    {edit.fileName}
                  </Text>
                  <Text dimColor>{statLine(edit)}</Text>
                </Box>
              </Box>
            );
          })}
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <DiffRenderer
            diffContent={selected.fileDiff}
            filename={selected.fileName}
            terminalWidth={Math.max(20, terminalWidth - FILE_LIST_WIDTH - 6)}
            availableTerminalHeight={availableTerminalHeight}
          />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ select file · Esc/q close · read-only</Text>
      </Box>
    </Box>
  );
};

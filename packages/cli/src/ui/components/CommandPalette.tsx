/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F1 of the PLUMB-UI-DEVRIM-PROMPT.md spec: a fuzzy command palette.
 * Scoped to the "Komutlar" (slash commands) source for this pass -- see
 * the PR/commit message for why the other four sources (sessions, files,
 * agents, settings) are deliberately deferred rather than rushed.
 */
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Box, Text, useIsScreenReaderEnabled } from 'ink';
import { useKeypress } from '../hooks/useKeypress.js';
import { theme } from '../semantic-colors.js';
import type { SlashCommand } from '../commands/types.js';
import { rankByFuzzyScore, type FuzzyMatch } from '../utils/paletteFuzzy.js';

export interface CommandPaletteProps {
  commands: readonly SlashCommand[];
  onExecute: (command: SlashCommand) => void;
  onClose: () => void;
  terminalWidth: number;
}

const MAX_VISIBLE_ROWS = 10;
const MODAL_MAX_WIDTH = 78;

function commandSearchText(command: SlashCommand): string {
  return [command.name, ...(command.altNames ?? [])].join(' ');
}

/** Splits `text` into segments so matched characters can be styled apart from the rest. */
function splitAtMatches(
  text: string,
  matchedIndices: readonly number[],
): Array<{ text: string; matched: boolean }> {
  if (matchedIndices.length === 0) {
    return [{ text, matched: false }];
  }
  const matchedSet = new Set(matchedIndices);
  const segments: Array<{ text: string; matched: boolean }> = [];
  let current = '';
  let currentMatched = matchedSet.has(0);
  for (let i = 0; i < text.length; i++) {
    const isMatched = matchedSet.has(i);
    if (i > 0 && isMatched !== currentMatched) {
      segments.push({ text: current, matched: currentMatched });
      current = '';
    }
    current += text[i];
    currentMatched = isMatched;
  }
  if (current) {
    segments.push({ text: current, matched: currentMatched });
  }
  return segments;
}

const HighlightedName: React.FC<{
  name: string;
  match: FuzzyMatch;
  isSelected: boolean;
}> = ({ name, match, isSelected }) => (
  <Text bold={isSelected} color={isSelected ? theme.text.primary : undefined}>
    {splitAtMatches(name, match.matchedIndices).map((segment, i) => (
      <Text
        key={i}
        color={segment.matched ? theme.text.accent : undefined}
        underline={segment.matched}
      >
        {segment.text}
      </Text>
    ))}
  </Text>
);

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  commands,
  onExecute,
  onClose,
  terminalWidth,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isScreenReaderEnabled = useIsScreenReaderEnabled();

  const visibleCommands = useMemo(
    () => commands.filter((c) => !c.hidden),
    [commands],
  );

  const results = useMemo(
    () => rankByFuzzyScore(visibleCommands, query, commandSearchText),
    [visibleCommands, query],
  );

  const clampedIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));

  const handleSelect = useCallback(() => {
    const selected = results[clampedIndex];
    if (selected) {
      onExecute(selected.item);
    }
  }, [results, clampedIndex, onExecute]);

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onClose();
        return true;
      }
      if (key.name === 'enter') {
        handleSelect();
        return true;
      }
      if (key.name === 'up') {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return true;
      }
      if (key.name === 'down') {
        setSelectedIndex((i) => Math.min(results.length - 1, i + 1));
        return true;
      }
      if (key.name === 'backspace') {
        setQuery((prev) => prev.slice(0, -1));
        setSelectedIndex(0);
        return true;
      }
      if (key.insertable && key.sequence && !key.ctrl && !key.alt && !key.cmd) {
        setQuery((prev) => prev + key.sequence);
        setSelectedIndex(0);
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  const width = Math.min(MODAL_MAX_WIDTH, terminalWidth - 4);
  const visibleResults = results.slice(0, MAX_VISIBLE_ROWS);

  if (isScreenReaderEnabled) {
    return (
      <Box flexDirection="column">
        <Text>Command palette. Query: {query || '(empty)'}</Text>
        {results.length === 0 ? (
          <Text>No matching commands.</Text>
        ) : (
          visibleResults.map(({ item }, i) => (
            <Text key={item.name}>
              {i === clampedIndex ? 'Selected: ' : ''}
              {item.name} — {item.description}
            </Text>
          ))
        )}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border.default}
      width={width}
      paddingX={1}
    >
      <Box>
        <Text color={theme.text.accent}>{'> '}</Text>
        <Text>{query}</Text>
        <Text dimColor>▌</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {results.length === 0 ? (
          <Text dimColor>No matching commands.</Text>
        ) : (
          visibleResults.map(({ item, match }, i) => {
            const isSelected = i === clampedIndex;
            return (
              <Box key={item.name}>
                <Text color={isSelected ? theme.text.accent : undefined}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                <Box width={16} flexShrink={0}>
                  <HighlightedName
                    name={`/${item.name}`}
                    match={match}
                    isSelected={isSelected}
                  />
                </Box>
                <Text dimColor wrap="truncate-end">
                  {item.description}
                </Text>
              </Box>
            );
          })
        )}
        {results.length > MAX_VISIBLE_ROWS && (
          <Text dimColor> +{results.length - MAX_VISIBLE_ROWS} more</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ navigate · Enter run · Esc close</Text>
      </Box>
    </Box>
  );
};

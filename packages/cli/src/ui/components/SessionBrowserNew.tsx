/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../semantic-colors.js';

interface Session {
  id: string;
  title: string;
  timestamp: string;
  messageCount: number;
  model?: string;
  preview?: string;
}

interface SessionBrowserProps {
  sessions: Session[];
  onSelect: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  onCancel: () => void;
  terminalWidth: number;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const SessionBrowser: React.FC<SessionBrowserProps> = ({
  sessions,
  onSelect,
  onDelete,
  onCancel,
  terminalWidth,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const filteredSessions = useMemo(() => {
    if (!searchQuery) return sessions;
    const query = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(query) ||
        s.preview?.toLowerCase().includes(query),
    );
  }, [sessions, searchQuery]);

  const handleKeyInput = useCallback(
    (input: string, key: { name?: string; ctrl?: boolean }) => {
      if (isSearching) {
        if (key.name === 'escape') {
          setIsSearching(false);
          setSearchQuery('');
          return;
        }
        if (key.name === 'return') {
          setIsSearching(false);
          return;
        }
        if (key.name === 'backspace') {
          setSearchQuery((prev) => prev.slice(0, -1));
          return;
        }
        if (input && !key.ctrl) {
          setSearchQuery((prev) => prev + input);
        }
        return;
      }

      switch (key.name) {
        case 'up':
        case 'k':
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          break;
        case 'down':
        case 'j':
          setSelectedIndex((prev) =>
            Math.min(filteredSessions.length - 1, prev + 1),
          );
          break;
        case 'return':
          if (filteredSessions[selectedIndex]) {
            onSelect(filteredSessions[selectedIndex].id);
          }
          break;
        case 'd':
          if (key.ctrl && onDelete && filteredSessions[selectedIndex]) {
            onDelete(filteredSessions[selectedIndex].id);
          }
          break;
        case 'f':
        case '/':
          setIsSearching(true);
          break;
        case 'escape':
          onCancel();
          break;
        case 'q':
          onCancel();
          break;
        default:
          break;
      }
    },
    [
      isSearching,
      filteredSessions,
      selectedIndex,
      onSelect,
      onDelete,
      onCancel,
    ],
  );

  useInput(handleKeyInput);

  const maxTitleWidth = Math.min(50, terminalWidth - 30);

  return (
    <Box flexDirection="column" padding={1}>
      <Box
        flexDirection="row"
        justifyContent="space-between"
        borderBottom
        borderColor={theme.border.default}
        paddingBottom={1}
      >
        <Text bold color={theme.text.accent}>
          {' '}
          Session History
        </Text>
        <Text color={theme.text.secondary}>
          {filteredSessions.length} session
          {filteredSessions.length !== 1 ? 's' : ''}
        </Text>
      </Box>

      {isSearching && (
        <Box paddingY={1}>
          <Text color={theme.text.accent}>Search: </Text>
          <Text color={theme.text.primary}>{searchQuery}</Text>
          <Text color={theme.text.secondary}>_</Text>
        </Box>
      )}

      {filteredSessions.length === 0 ? (
        <Box paddingY={2} justifyContent="center">
          <Text color={theme.text.secondary}>
            {searchQuery
              ? 'No sessions match your search'
              : 'No sessions found'}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" paddingY={1}>
          {filteredSessions.map((session, index) => {
            const isSelected = index === selectedIndex;
            const truncatedTitle =
              session.title.length > maxTitleWidth
                ? session.title.substring(0, maxTitleWidth - 3) + '...'
                : session.title;

            return (
              <Box
                key={session.id}
                flexDirection="column"
                paddingX={1}
                paddingY={0}
              >
                <Box flexDirection="row">
                  <Text
                    color={isSelected ? theme.text.accent : theme.text.primary}
                    bold={isSelected}
                  >
                    {isSelected ? '❯ ' : '  '}
                    {isSelected ? '[' : ' '}
                    {truncatedTitle}
                    {isSelected ? ']' : ' '}
                  </Text>
                </Box>
                <Box flexDirection="row" paddingLeft={4}>
                  <Text color={theme.text.secondary} dimColor>
                    {formatRelativeTime(session.timestamp)}
                  </Text>
                  <Text color={theme.text.secondary}> · </Text>
                  <Text color={theme.text.secondary}>
                    {session.messageCount} messages
                  </Text>
                  {session.model && (
                    <>
                      <Text color={theme.text.secondary}> · </Text>
                      <Text color={theme.text.secondary}>{session.model}</Text>
                    </>
                  )}
                </Box>
                {session.preview && (
                  <Box paddingLeft={4}>
                    <Text color={theme.text.secondary} dimColor>
                      {session.preview.substring(0, terminalWidth - 8)}
                    </Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      <Box
        flexDirection="row"
        justifyContent="center"
        borderTop
        borderColor={theme.border.default}
        paddingTop={1}
      >
        <Text color={theme.text.secondary}>{'↑↓'} Navigate</Text>
        <Text color={theme.text.secondary}>{' · '}</Text>
        <Text color={theme.text.secondary}>{'Enter'} Select</Text>
        <Text color={theme.text.secondary}>{' · '}</Text>
        <Text color={theme.text.secondary}>{'/'} Search</Text>
        {onDelete && (
          <>
            <Text color={theme.text.secondary}>{' · '}</Text>
            <Text color={theme.text.secondary}>{'Ctrl+D'} Delete</Text>
          </>
        )}
        <Text color={theme.text.secondary}>{' · '}</Text>
        <Text color={theme.text.secondary}>{'Esc'} Cancel</Text>
      </Box>
    </Box>
  );
};

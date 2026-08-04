/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Source provenance:
 *   repository: https://github.com/chauncygu/collection-claude-code-source-code
 *   reference: claude-code-source-code/src/components/ (Claude Code input UI)
 *   license: Apache-2.0 (collection repo)
 *   original-license: Anthropic proprietary (extracted npm package)
 *   adaptation: Original PLUMB implementation. Inspired by Claude Code
 *     PromptInput/multi-mode input patterns. Not copied from any specific file.
 *   substantial-similarity: LOW (independent implementation)
 *   redistribution: Apache-2.0 (original CLAUDE_CODE source: Anthropic)
 */

import type React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../semantic-colors.js';

type InputMode = 'prompt' | 'command' | 'shell' | 'search';

interface PromptInputNewProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  mode?: InputMode;
  onModeChange?: (mode: InputMode) => void;
  showModeIndicator?: boolean;
  showCharCount?: boolean;
  maxChars?: number;
  terminalWidth: number;
  streamingState?: 'idle' | 'responding' | 'waiting';
  queuedCommands?: string[];
  onClearQueue?: () => void;
}

const MODE_CONFIG: Record<
  InputMode,
  { prefix: string; color: string; label: string }
> = {
  prompt: { prefix: '❯', color: theme.text.accent, label: '' },
  command: { prefix: '/', color: theme.status.warning, label: 'CMD' },
  shell: { prefix: '!', color: theme.status.success, label: 'SH' },
  search: { prefix: '?', color: theme.ui.active, label: 'SEARCH' },
};

export const PromptInputNew: React.FC<PromptInputNewProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = 'Type your message...',
  disabled = false,
  mode = 'prompt',
  onModeChange,
  showModeIndicator = true,
  showCharCount = false,
  maxChars,
  terminalWidth,
  streamingState = 'idle',
  queuedCommands = [],
  onClearQueue,
}) => {
  const [cursorVisible, setCursorVisible] = useState(true);
  const inputRef = useRef<string>(value);
  const currentValueRef = useRef<string>(value);

  const modeConfig = MODE_CONFIG[mode];
  const isStreaming = streamingState === 'responding';
  const isWaiting = streamingState === 'waiting';

  useEffect(() => {
    inputRef.current = value;
    currentValueRef.current = value;
  }, [value]);

  // Wire keyboard input to onChange, onSubmit, and onModeChange
  useInput(
    useCallback(
      (
        input: string,
        key: { name?: string; ctrl?: boolean; meta?: boolean },
      ) => {
        if (disabled) return;
        if (isStreaming || isWaiting) return;

        // Mode switching
        if (input === '/' && !key.ctrl && currentValueRef.current === '') {
          onModeChange?.('command');
          return;
        }
        if (input === '!' && !key.ctrl && currentValueRef.current === '') {
          onModeChange?.('shell');
          return;
        }
        if (input === '?' && !key.ctrl && currentValueRef.current === '') {
          onModeChange?.('search');
          return;
        }

        // Submit on Enter
        if (key.name === 'return') {
          onSubmit(currentValueRef.current);
          return;
        }

        // Backspace
        if (key.name === 'backspace') {
          const newValue = currentValueRef.current.slice(0, -1);
          currentValueRef.current = newValue;
          onChange(newValue);
          return;
        }

        // Escape: return to prompt mode
        if (key.name === 'escape') {
          if (mode !== 'prompt') {
            onModeChange?.('prompt');
          }
          return;
        }

        // Regular character input
        if (input && !key.ctrl && !key.meta) {
          const newValue = currentValueRef.current + input;
          currentValueRef.current = newValue;
          onChange(newValue);
        }
      },
      [
        disabled,
        isStreaming,
        isWaiting,
        mode,
        onChange,
        onSubmit,
        onModeChange,
      ],
    ),
  );

  useEffect(() => {
    if (disabled) return;

    const interval = setInterval(() => {
      setCursorVisible((prev) => !prev);
    }, 530);

    return () => clearInterval(interval);
  }, [disabled]);

  const charCount = value.length;
  const isOverLimit = maxChars ? charCount > maxChars : false;

  const displayValue = value || placeholder;
  const showPlaceholder = !value;

  const renderInputArea = () => {
    const INPUT_PADDING = 2;
    const BORDER_WIDTH = 2;
    const PREFIX_WIDTH = 2;
    const MODE_INDICATOR_WIDTH = showModeIndicator && mode !== 'prompt' ? 8 : 0;
    const CHAR_COUNT_WIDTH = showCharCount ? 8 : 0;

    const availableWidth =
      terminalWidth -
      INPUT_PADDING -
      BORDER_WIDTH -
      PREFIX_WIDTH -
      MODE_INDICATOR_WIDTH -
      CHAR_COUNT_WIDTH;

    const truncatedValue =
      displayValue.length > availableWidth
        ? displayValue.substring(0, availableWidth - 3) + '...'
        : displayValue;

    return (
      <Box flexDirection="row" alignItems="center">
        <Text color={modeConfig.color} bold>
          {modeConfig.prefix}{' '}
        </Text>

        <Box flexGrow={1}>
          {showPlaceholder ? (
            <Text dimColor>{truncatedValue}</Text>
          ) : (
            <Text>{truncatedValue}</Text>
          )}
          {!disabled && cursorVisible && (
            <Text color={theme.text.accent}>▌</Text>
          )}
        </Box>

        {showModeIndicator && mode !== 'prompt' && (
          <Box marginLeft={1}>
            <Text
              color={modeConfig.color}
              backgroundColor={theme.background.primary}
              bold
            >
              {modeConfig.label}
            </Text>
          </Box>
        )}

        {showCharCount && (
          <Box marginLeft={1}>
            <Text
              color={isOverLimit ? theme.status.error : theme.text.secondary}
              dimColor={!isOverLimit}
            >
              {charCount}
              {maxChars ? `/${maxChars}` : ''}
            </Text>
          </Box>
        )}
      </Box>
    );
  };

  const renderStatusBar = () => {
    if (streamingState === 'idle' && queuedCommands.length === 0) {
      return null;
    }

    return (
      <Box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={2}
        paddingRight={1}
      >
        <Box flexDirection="row">
          {isStreaming && (
            <Text color={theme.status.warning}>⠋ Responding...</Text>
          )}
          {isWaiting && (
            <Text color={theme.status.warning}>
              Waiting for confirmation...
            </Text>
          )}
        </Box>

        {queuedCommands.length > 0 && (
          <Box flexDirection="row">
            <Text color={theme.text.secondary}>
              {queuedCommands.length} queued
            </Text>
            {onClearQueue && (
              <Text color={theme.text.secondary} dimColor>
                {' '}
                (Ctrl+C to clear)
              </Text>
            )}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" width={terminalWidth}>
      {renderStatusBar()}

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={
          disabled
            ? theme.border.default
            : isStreaming
              ? theme.status.warning
              : theme.ui.active
        }
        paddingX={1}
        paddingY={0}
      >
        {renderInputArea()}
      </Box>

      {showModeIndicator && mode !== 'prompt' && (
        <Box paddingLeft={2} paddingTop={0}>
          <Text color={modeConfig.color} dimColor>
            {mode === 'command' && 'Enter command name or type to search'}
            {mode === 'shell' && 'Enter shell command'}
            {mode === 'search' && 'Search history'}
          </Text>
        </Box>
      )}
    </Box>
  );
};

interface PromptInputHintsProps {
  mode: InputMode;
  streamingState: 'idle' | 'responding' | 'waiting';
  vimMode?: string;
  showShortcuts?: boolean;
}

export const PromptInputHints: React.FC<PromptInputHintsProps> = ({
  mode,
  streamingState,
  vimMode,
  showShortcuts = true,
}) => {
  if (!showShortcuts) return null;

  const isStreaming = streamingState === 'responding';

  return (
    <Box flexDirection="row" paddingLeft={2} gap={2}>
      {mode === 'prompt' && !isStreaming && (
        <>
          <Text color={theme.text.secondary}>
            <Text color={theme.text.accent}>Enter</Text> submit
          </Text>
          <Text color={theme.text.secondary}>
            <Text color={theme.text.accent}>Shift+Enter</Text> newline
          </Text>
          <Text color={theme.text.secondary}>
            <Text color={theme.text.accent}>/</Text> command
          </Text>
          <Text color={theme.text.secondary}>
            <Text color={theme.text.accent}>!</Text> shell
          </Text>
        </>
      )}

      {isStreaming && (
        <Text color={theme.text.secondary}>
          <Text color={theme.status.warning}>Esc</Text> cancel
        </Text>
      )}

      {vimMode && (
        <Text color={theme.text.secondary}>
          Vim: <Text color={theme.text.accent}>{vimMode}</Text>
        </Text>
      )}
    </Box>
  );
};

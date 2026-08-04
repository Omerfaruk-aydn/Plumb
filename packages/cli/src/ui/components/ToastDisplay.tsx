/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { useUIState, type UIState } from '../contexts/UIStateContext.js';
import { useInputState, type InputState } from '../contexts/InputContext.js';
import { TransientMessageType } from '../../utils/events.js';
import { CompactSummary } from './CompactSummary.js';

export function shouldShowToast(
  uiState: UIState,
  inputState: InputState,
): boolean {
  return (
    uiState.ctrlCPressedOnce ||
    Boolean(uiState.transientMessage) ||
    uiState.ctrlDPressedOnce ||
    (inputState.showEscapePrompt &&
      (inputState.buffer.text.length > 0 || uiState.history.length > 0)) ||
    Boolean(uiState.queueErrorMessage) ||
    uiState.showIsExpandableHint
  );
}

export const ToastDisplay: React.FC = () => {
  const uiState = useUIState();
  const inputState = useInputState();

  if (uiState.ctrlCPressedOnce) {
    return (
      <Text color={theme.status.warning}>Press Ctrl+C again to exit.</Text>
    );
  }

  if (
    uiState.transientMessage?.type === TransientMessageType.Warning &&
    uiState.transientMessage.text
  ) {
    return (
      <Text color={theme.status.warning}>{uiState.transientMessage.text}</Text>
    );
  }

  if (uiState.ctrlDPressedOnce) {
    return (
      <Text color={theme.status.warning}>Press Ctrl+D again to exit.</Text>
    );
  }

  if (inputState.showEscapePrompt) {
    const isPromptEmpty = inputState.buffer.text.length === 0;
    const hasHistory = uiState.history.length > 0;

    if (isPromptEmpty && !hasHistory) {
      return null;
    }

    return (
      <Text color={theme.text.secondary}>
        Press Esc again to {isPromptEmpty ? 'rewind' : 'clear prompt'}.
      </Text>
    );
  }

  if (
    uiState.transientMessage?.type === TransientMessageType.Hint &&
    uiState.transientMessage.text
  ) {
    return (
      <Text color={theme.text.secondary}>{uiState.transientMessage.text}</Text>
    );
  }

  if (uiState.queueErrorMessage) {
    return <Text color={theme.status.error}>{uiState.queueErrorMessage}</Text>;
  }

  if (uiState.showIsExpandableHint) {
    const action = uiState.constrainHeight ? 'show more' : 'collapse';
    return (
      <Text color={theme.text.secondary}>
        Press Ctrl+O to {action} lines of the last response
      </Text>
    );
  }

  // Show compaction summary when compaction occurs
  if (
    uiState.transientMessage?.type === TransientMessageType.Hint &&
    uiState.transientMessage.text?.includes('compacted')
  ) {
    return (
      <CompactSummary
        originalMessageCount={uiState.history.length}
        compactedMessageCount={Math.max(1, uiState.history.length - 5)}
        tokensSaved={5000}
        summary={uiState.transientMessage.text}
        terminalWidth={80}
      />
    );
  }

  return null;
};

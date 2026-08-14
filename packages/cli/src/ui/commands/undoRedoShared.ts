/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F19 (PLUMB-UI-DEVRIM-PROMPT.md): shared plumbing for /undo and /redo --
 * resolving the config/client/recording-service triple both commands need,
 * and pushing a restored message list back into the client + UI history
 * (mirrors what rewindCommand.tsx does after a chat rewind).
 */
import type {
  Config,
  ChatRecordingService,
  GeminiClient,
  MessageRecord,
  MessageActionReturn,
} from '@plumb/core';
import { convertSessionToClientHistory } from '@plumb/core';
import type { CommandContext } from './types.js';
import type { HistoryItem } from '../types.js';
import { convertSessionToHistoryFormats } from '../hooks/useSessionBrowser.js';

export interface UndoRedoServices {
  config: Config;
  client: GeminiClient;
  recordingService: ChatRecordingService;
}

export function resolveUndoRedoServices(
  context: CommandContext,
): UndoRedoServices | MessageActionReturn {
  const agentContext = context.services.agentContext;
  const config = agentContext?.config;
  if (!config) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Config not found',
    };
  }

  const client = agentContext.geminiClient;
  if (!client) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Client not initialized',
    };
  }

  const recordingService = client.getChatRecordingService();
  if (!recordingService) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Recording service unavailable',
    };
  }

  return { config, client, recordingService };
}

export function isUndoRedoServices(
  value: UndoRedoServices | MessageActionReturn,
): value is UndoRedoServices {
  return 'client' in value;
}

/** Pushes a full message list into the client and UI history, replacing what's currently shown. */
export function applyRestoredMessages(
  context: CommandContext,
  client: GeminiClient,
  messages: MessageRecord[],
): void {
  const clientHistory = convertSessionToClientHistory(messages);
  client.setHistory(clientHistory);

  const { uiHistory } = convertSessionToHistoryFormats(messages);
  const historyWithIds = uiHistory.map(
    (item, idx) => ({ ...item, id: idx + 1 }) as HistoryItem,
  );
  context.ui.loadHistory(historyWithIds, '');
}

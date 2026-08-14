/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F19 (PLUMB-UI-DEVRIM-PROMPT.md): /redo reverses the most recent /undo,
 * restoring both the file state and the conversation it undid.
 */
import {
  CommandKind,
  type CommandContext,
  type SlashCommand,
} from './types.js';
import { coreEvents } from '@plumb/core';
import { getUndoRedoStack } from '../utils/undoRedoStack.js';
import {
  resolveUndoRedoServices,
  isUndoRedoServices,
  applyRestoredMessages,
} from './undoRedoShared.js';

export const redoCommand: SlashCommand = {
  name: 'redo',
  description: 'Redo the last undone turn',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    const services = resolveUndoRedoServices(context);
    if (!isUndoRedoServices(services)) return services;
    const { config, client, recordingService } = services;

    const stack = getUndoRedoStack(config);
    if (!stack.hasRedo) {
      return {
        type: 'message' as const,
        messageType: 'info' as const,
        content: 'Nothing to redo.',
      };
    }

    let gitService;
    try {
      gitService = await config.getGitService();
    } catch (error) {
      return {
        type: 'message' as const,
        messageType: 'error' as const,
        content: `/redo requires Git: ${error instanceof Error ? error.message : 'Git is unavailable.'}`,
      };
    }

    const entry = stack.popRedo();
    if (!entry) {
      return {
        type: 'message' as const,
        messageType: 'info' as const,
        content: 'Nothing to redo.',
      };
    }

    try {
      await gitService.restoreProjectFromSnapshot(entry.filesCommitHash);
    } catch (error) {
      coreEvents.emitFeedback(
        'error',
        `Failed to restore file changes: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return;
    }

    recordingService.restoreMessages(entry.messages);
    applyRestoredMessages(context, client, entry.messages);

    coreEvents.emitFeedback('info', '1 turn redone.');
    return;
  },
};

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F19 (PLUMB-UI-DEVRIM-PROMPT.md): /undo rewinds the conversation by one
 * turn AND reverts that turn's file changes, using the shadow-git snapshots
 * `captureTurnSnapshot` (undoRedoStack.ts) takes before every turn.
 */
import {
  CommandKind,
  type CommandContext,
  type SlashCommand,
} from './types.js';
import { coreEvents, debugLogger } from '@plumb/core';
import { getUndoRedoStack } from '../utils/undoRedoStack.js';
import {
  resolveUndoRedoServices,
  isUndoRedoServices,
  applyRestoredMessages,
} from './undoRedoShared.js';

export const undoCommand: SlashCommand = {
  name: 'undo',
  description:
    'Undo the last turn: rewinds the conversation and reverts its file changes',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    const services = resolveUndoRedoServices(context);
    if (!isUndoRedoServices(services)) return services;
    const { config, client, recordingService } = services;

    const stack = getUndoRedoStack(config);
    if (!stack.hasUndo) {
      return {
        type: 'message' as const,
        messageType: 'info' as const,
        content: 'Nothing to undo.',
      };
    }

    let gitService;
    try {
      gitService = await config.getGitService();
    } catch (error) {
      return {
        type: 'message' as const,
        messageType: 'error' as const,
        content: `/undo requires Git: ${error instanceof Error ? error.message : 'Git is unavailable.'}`,
      };
    }

    const snapshot = stack.popUndo();
    if (!snapshot) {
      return {
        type: 'message' as const,
        messageType: 'info' as const,
        content: 'Nothing to undo.',
      };
    }

    const conversation = recordingService.getConversation();
    const messagesBeforeUndo = (conversation?.messages ?? []).slice();

    let preUndoFilesCommit: string | null = null;
    try {
      preUndoFilesCommit = await gitService.createFileSnapshot(
        'undo: pre-undo state (for redo)',
      );
    } catch (error) {
      debugLogger.debug(
        'undo: failed to snapshot pre-undo state, /redo will be unavailable for this step:',
        error,
      );
    }

    let changedFileCount = 0;
    try {
      changedFileCount = await gitService.getChangedFileCount(
        snapshot.commitHash,
      );
      await gitService.restoreProjectFromSnapshot(snapshot.commitHash);
    } catch (error) {
      coreEvents.emitFeedback(
        'error',
        `Failed to revert file changes: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return;
    }

    if (snapshot.beforeMessageId) {
      recordingService.rewindTo(snapshot.beforeMessageId);
    } else {
      recordingService.restoreMessages([]);
    }

    const updatedConversation = recordingService.getConversation();
    applyRestoredMessages(context, client, updatedConversation?.messages ?? []);

    if (preUndoFilesCommit) {
      stack.pushRedo({
        filesCommitHash: preUndoFilesCommit,
        messages: messagesBeforeUndo,
      });
    }

    const fileNote =
      changedFileCount > 0
        ? ` · ${changedFileCount} file${changedFileCount === 1 ? '' : 's'} reverted`
        : '';
    const redoNote = preUndoFilesCommit ? ' · /redo to bring it back' : '';
    coreEvents.emitFeedback('info', `1 turn undone${fileNote}${redoNote}`);
    return;
  },
};

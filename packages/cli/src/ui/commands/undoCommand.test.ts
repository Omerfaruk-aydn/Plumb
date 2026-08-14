/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { undoCommand } from './undoCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { getUndoRedoStack } from '../utils/undoRedoStack.js';
import { coreEvents } from '@plumb/core';
import type { CommandContext } from './types.js';
import type { Config } from '@plumb/core';

vi.mock('@plumb/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plumb/core')>();
  return {
    ...actual,
    coreEvents: {
      // eslint-disable-next-line @typescript-eslint/no-misused-spread
      ...actual.coreEvents,
      emitFeedback: vi.fn(),
    },
  };
});

vi.mock('../hooks/useSessionBrowser.js', () => ({
  convertSessionToHistoryFormats: vi.fn().mockReturnValue({
    uiHistory: [{ type: 'user', text: 'kept' }],
  }),
}));

const mockRewindTo = vi.fn();
const mockRestoreMessages = vi.fn();
const mockGetConversation = vi.fn();
const mockSetHistory = vi.fn();
const mockLoadHistory = vi.fn();

const mockCreateFileSnapshot = vi.fn();
const mockGetChangedFileCount = vi.fn();
const mockRestoreProjectFromSnapshot = vi.fn();
const mockGetGitService = vi.fn();

function makeContext(): CommandContext {
  const config = {
    getGitService: mockGetGitService,
  } as unknown as Config;

  return createMockCommandContext({
    services: {
      agentContext: {
        config,
        geminiClient: {
          getChatRecordingService: () => ({
            getConversation: mockGetConversation,
            rewindTo: mockRewindTo,
            restoreMessages: mockRestoreMessages,
          }),
          setHistory: mockSetHistory,
        },
      },
    },
    ui: {
      loadHistory: mockLoadHistory,
    },
  }) as unknown as CommandContext;
}

describe('undoCommand', () => {
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = makeContext();

    mockGetGitService.mockResolvedValue({
      createFileSnapshot: mockCreateFileSnapshot,
      getChangedFileCount: mockGetChangedFileCount,
      restoreProjectFromSnapshot: mockRestoreProjectFromSnapshot,
    });
    mockCreateFileSnapshot.mockResolvedValue('pre-undo-commit');
    mockGetChangedFileCount.mockResolvedValue(2);
    mockRestoreProjectFromSnapshot.mockResolvedValue(undefined);
    mockGetConversation.mockReturnValue({
      messages: [{ id: 'm1' }, { id: 'm2' }],
    });

    const config = context.services.agentContext!.config;
    getUndoRedoStack(config).reset();
  });

  it('reports nothing to undo when the stack is empty', async () => {
    const result = await undoCommand.action!(context, '');
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'Nothing to undo.',
    });
    expect(mockRestoreProjectFromSnapshot).not.toHaveBeenCalled();
  });

  it('reverts files, rewinds chat, and reports a toast on success', async () => {
    const config = context.services.agentContext!.config;
    getUndoRedoStack(config).pushTurn({
      commitHash: 'turn-1-commit',
      beforeMessageId: 'm1',
    });

    await undoCommand.action!(context, '');

    expect(mockGetChangedFileCount).toHaveBeenCalledWith('turn-1-commit');
    expect(mockRestoreProjectFromSnapshot).toHaveBeenCalledWith(
      'turn-1-commit',
    );
    expect(mockRewindTo).toHaveBeenCalledWith('m1');
    expect(mockSetHistory).toHaveBeenCalled();
    expect(mockLoadHistory).toHaveBeenCalled();
    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('1 turn undone'),
    );
    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('2 files reverted'),
    );
  });

  it('clears the whole conversation when undoing the very first turn', async () => {
    const config = context.services.agentContext!.config;
    getUndoRedoStack(config).pushTurn({
      commitHash: 'turn-1-commit',
      beforeMessageId: null,
    });

    await undoCommand.action!(context, '');

    expect(mockRestoreMessages).toHaveBeenCalledWith([]);
    expect(mockRewindTo).not.toHaveBeenCalled();
  });

  it('pushes a redo entry so the undo can be reversed', async () => {
    const config = context.services.agentContext!.config;
    getUndoRedoStack(config).pushTurn({
      commitHash: 'turn-1-commit',
      beforeMessageId: 'm1',
    });

    await undoCommand.action!(context, '');

    expect(getUndoRedoStack(config).hasRedo).toBe(true);
  });

  it('surfaces a clear error and leaves the stack untouched when Git is unavailable', async () => {
    const config = context.services.agentContext!.config;
    getUndoRedoStack(config).pushTurn({
      commitHash: 'turn-1-commit',
      beforeMessageId: 'm1',
    });
    mockGetGitService.mockRejectedValue(new Error('Git is not installed'));

    const result = await undoCommand.action!(context, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: expect.stringContaining('requires Git'),
    });
    expect(mockRestoreProjectFromSnapshot).not.toHaveBeenCalled();
    // Nothing was consumed on failure -- the turn is still there to retry.
    expect(getUndoRedoStack(config).hasUndo).toBe(true);
  });

  it('reports an error and stops when the file revert itself fails (e.g. a dirty/conflicting tree)', async () => {
    const config = context.services.agentContext!.config;
    getUndoRedoStack(config).pushTurn({
      commitHash: 'turn-1-commit',
      beforeMessageId: 'm1',
    });
    mockRestoreProjectFromSnapshot.mockRejectedValue(
      new Error('conflicting local changes'),
    );

    await undoCommand.action!(context, '');

    expect(mockRewindTo).not.toHaveBeenCalled();
    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('Failed to revert file changes'),
    );
  });
});

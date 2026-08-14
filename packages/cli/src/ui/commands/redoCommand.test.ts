/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { redoCommand } from './redoCommand.js';
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
    uiHistory: [{ type: 'user', text: 'restored' }],
  }),
}));

const mockRestoreMessages = vi.fn();
const mockGetConversation = vi.fn();
const mockSetHistory = vi.fn();
const mockLoadHistory = vi.fn();

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

describe('redoCommand', () => {
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = makeContext();

    mockGetGitService.mockResolvedValue({
      restoreProjectFromSnapshot: mockRestoreProjectFromSnapshot,
    });
    mockRestoreProjectFromSnapshot.mockResolvedValue(undefined);
    mockGetConversation.mockReturnValue({ messages: [] });

    const config = context.services.agentContext!.config;
    getUndoRedoStack(config).reset();
  });

  it('reports nothing to redo when the stack is empty', async () => {
    const result = await redoCommand.action!(context, '');
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'Nothing to redo.',
    });
    expect(mockRestoreProjectFromSnapshot).not.toHaveBeenCalled();
  });

  it('restores files and messages from the redo entry, then reports a toast', async () => {
    const config = context.services.agentContext!.config;
    const messages = [{ id: 'm1' }, { id: 'm2' }] as never;
    getUndoRedoStack(config).pushRedo({
      filesCommitHash: 'pre-undo-commit',
      messages,
    });

    await redoCommand.action!(context, '');

    expect(mockRestoreProjectFromSnapshot).toHaveBeenCalledWith(
      'pre-undo-commit',
    );
    expect(mockRestoreMessages).toHaveBeenCalledWith(messages);
    expect(mockSetHistory).toHaveBeenCalled();
    expect(mockLoadHistory).toHaveBeenCalled();
    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'info',
      '1 turn redone.',
    );
  });

  it('consumes the redo entry (a second /redo has nothing left)', async () => {
    const config = context.services.agentContext!.config;
    getUndoRedoStack(config).pushRedo({
      filesCommitHash: 'pre-undo-commit',
      messages: [],
    });

    await redoCommand.action!(context, '');
    const second = await redoCommand.action!(context, '');

    expect(second).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'Nothing to redo.',
    });
  });

  it('surfaces a clear error when Git is unavailable', async () => {
    const config = context.services.agentContext!.config;
    getUndoRedoStack(config).pushRedo({
      filesCommitHash: 'pre-undo-commit',
      messages: [],
    });
    mockGetGitService.mockRejectedValue(new Error('Git is not installed'));

    const result = await redoCommand.action!(context, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: expect.stringContaining('requires Git'),
    });
    expect(mockRestoreMessages).not.toHaveBeenCalled();
  });

  it('reports an error and does not touch chat history when the file restore fails', async () => {
    const config = context.services.agentContext!.config;
    getUndoRedoStack(config).pushRedo({
      filesCommitHash: 'pre-undo-commit',
      messages: [],
    });
    mockRestoreProjectFromSnapshot.mockRejectedValue(new Error('boom'));

    await redoCommand.action!(context, '');

    expect(mockRestoreMessages).not.toHaveBeenCalled();
    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('Failed to restore file changes'),
    );
  });
});

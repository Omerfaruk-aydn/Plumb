/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  UndoRedoStack,
  getUndoRedoStack,
  captureTurnSnapshot,
} from './undoRedoStack.js';
import type { Config, ChatRecordingService } from '@plumb/core';

describe('UndoRedoStack', () => {
  it('pops turns in LIFO order (multi-undo)', () => {
    const stack = new UndoRedoStack();
    stack.pushTurn({ commitHash: 'a', beforeMessageId: 'm1' });
    stack.pushTurn({ commitHash: 'b', beforeMessageId: 'm2' });
    stack.pushTurn({ commitHash: 'c', beforeMessageId: 'm3' });

    expect(stack.popUndo()).toEqual({ commitHash: 'c', beforeMessageId: 'm3' });
    expect(stack.popUndo()).toEqual({ commitHash: 'b', beforeMessageId: 'm2' });
    expect(stack.hasUndo).toBe(true);
    expect(stack.popUndo()).toEqual({ commitHash: 'a', beforeMessageId: 'm1' });
    expect(stack.hasUndo).toBe(false);
    expect(stack.popUndo()).toBeUndefined();
  });

  it('clears the redo stack whenever a new turn is pushed', () => {
    const stack = new UndoRedoStack();
    stack.pushTurn({ commitHash: 'a', beforeMessageId: null });
    stack.pushRedo({ filesCommitHash: 'r1', messages: [] });
    expect(stack.hasRedo).toBe(true);

    // A new user turn starting invalidates whatever was undone.
    stack.pushTurn({ commitHash: 'b', beforeMessageId: 'm1' });
    expect(stack.hasRedo).toBe(false);
  });

  it('pushRedo/popRedo round-trips independently of the undo stack', () => {
    const stack = new UndoRedoStack();
    const entry = { filesCommitHash: 'r1', messages: [{ id: 'm1' }] } as never;
    stack.pushRedo(entry);
    expect(stack.hasRedo).toBe(true);
    expect(stack.popRedo()).toEqual(entry);
    expect(stack.hasRedo).toBe(false);
  });

  it('reset() clears both stacks', () => {
    const stack = new UndoRedoStack();
    stack.pushTurn({ commitHash: 'a', beforeMessageId: null });
    stack.pushRedo({ filesCommitHash: 'r1', messages: [] });
    stack.reset();
    expect(stack.hasUndo).toBe(false);
    expect(stack.hasRedo).toBe(false);
  });

  it('getUndoRedoStack returns the same instance for the same Config', () => {
    const config = {} as Config;
    const first = getUndoRedoStack(config);
    const second = getUndoRedoStack(config);
    expect(first).toBe(second);

    const otherConfig = {} as Config;
    expect(getUndoRedoStack(otherConfig)).not.toBe(first);
  });
});

describe('captureTurnSnapshot', () => {
  let getGitService: ReturnType<typeof vi.fn>;
  let createFileSnapshot: ReturnType<typeof vi.fn>;
  let getConversation: ReturnType<typeof vi.fn>;
  let config: Config;
  let recordingService: ChatRecordingService;

  beforeEach(() => {
    createFileSnapshot = vi.fn().mockResolvedValue('abc123');
    getGitService = vi.fn().mockResolvedValue({ createFileSnapshot });
    getConversation = vi.fn().mockReturnValue({
      messages: [{ id: 'm1' }, { id: 'm2' }],
    });
    config = { getGitService } as unknown as Config;
    recordingService = {
      getConversation,
    } as unknown as ChatRecordingService;
  });

  it('records a commit hash and the last message id before the turn', async () => {
    await captureTurnSnapshot(config, recordingService);

    const stack = getUndoRedoStack(config);
    expect(stack.hasUndo).toBe(true);
    expect(createFileSnapshot).toHaveBeenCalledWith(
      expect.stringContaining('pre-turn'),
    );
    expect(stack.popUndo()).toEqual({
      commitHash: 'abc123',
      beforeMessageId: 'm2',
    });
  });

  it('records beforeMessageId: null for the very first turn (empty conversation)', async () => {
    getConversation.mockReturnValue({ messages: [] });
    await captureTurnSnapshot(config, recordingService);

    expect(getUndoRedoStack(config).popUndo()).toEqual({
      commitHash: 'abc123',
      beforeMessageId: null,
    });
  });

  it('does nothing (no throw) when Git is unavailable', async () => {
    getGitService.mockRejectedValue(new Error('Git is not installed'));
    const freshConfig = { getGitService } as unknown as Config;

    await expect(
      captureTurnSnapshot(freshConfig, recordingService),
    ).resolves.toBeUndefined();
    expect(getUndoRedoStack(freshConfig).hasUndo).toBe(false);
  });

  it('is a no-op when there is no recording service', async () => {
    await captureTurnSnapshot(config, undefined);
    expect(getGitService).not.toHaveBeenCalled();
  });
});

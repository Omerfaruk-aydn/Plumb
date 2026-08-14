/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F19 (PLUMB-UI-DEVRIM-PROMPT.md): in-memory undo/redo stacks backing the
 * /undo and /redo commands. Populated proactively -- `captureTurnSnapshot`
 * is called from `useGeminiStream` right before every real (non-continuation)
 * user turn, so /undo itself needs no extra round-trip at invocation time.
 *
 * State lives entirely in this process: it is keyed by `Config` instance
 * (one per session) and is not persisted to disk, so it does not survive a
 * CLI restart. That mirrors the UX spec, which only requires the stack to
 * clear on new input, not to outlive the session.
 */
import type { Config, ChatRecordingService, MessageRecord } from '@plumb/core';
import { debugLogger } from '@plumb/core';

export interface TurnSnapshot {
  /** Shadow-repo commit hash capturing file state right before this turn. */
  commitHash: string;
  /** Id of the last recorded message before this turn, or null if the turn was the very first one. */
  beforeMessageId: string | null;
}

export interface RedoSnapshot {
  /** Shadow-repo commit hash capturing file state right before the undo that produced this entry. */
  filesCommitHash: string;
  /** Full message list as it stood right before the undo that produced this entry. */
  messages: MessageRecord[];
}

export class UndoRedoStack {
  private undoEntries: TurnSnapshot[] = [];
  private redoEntries: RedoSnapshot[] = [];

  pushTurn(snapshot: TurnSnapshot): void {
    this.undoEntries.push(snapshot);
    // A fresh turn invalidates anything that was previously undone.
    this.redoEntries = [];
  }

  popUndo(): TurnSnapshot | undefined {
    return this.undoEntries.pop();
  }

  pushRedo(snapshot: RedoSnapshot): void {
    this.redoEntries.push(snapshot);
  }

  popRedo(): RedoSnapshot | undefined {
    return this.redoEntries.pop();
  }

  get hasUndo(): boolean {
    return this.undoEntries.length > 0;
  }

  get hasRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  reset(): void {
    this.undoEntries = [];
    this.redoEntries = [];
  }
}

const stacksByConfig = new WeakMap<Config, UndoRedoStack>();

export function getUndoRedoStack(config: Config): UndoRedoStack {
  let stack = stacksByConfig.get(config);
  if (!stack) {
    stack = new UndoRedoStack();
    stacksByConfig.set(config, stack);
  }
  return stack;
}

/**
 * Takes a shadow-git file snapshot and records the conversation boundary for
 * the turn about to start. Best-effort: if Git is unavailable or the
 * snapshot fails, this silently skips (leaving /undo with one fewer step
 * available) rather than interrupting the user's turn.
 */
export async function captureTurnSnapshot(
  config: Config,
  recordingService: ChatRecordingService | undefined,
): Promise<void> {
  if (!recordingService) return;
  try {
    const gitService = await config.getGitService();
    const commitHash = await gitService.createFileSnapshot(
      'undo: pre-turn snapshot',
    );
    const conversation = recordingService.getConversation();
    const lastMessage = conversation?.messages.at(-1);
    getUndoRedoStack(config).pushTurn({
      commitHash,
      beforeMessageId: lastMessage?.id ?? null,
    });
  } catch (error) {
    debugLogger.debug('undo: failed to capture pre-turn snapshot:', error);
  }
}

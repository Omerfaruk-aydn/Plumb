/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { act } from 'react';
import { DiffReviewScreen } from './DiffReviewScreen.js';
import type { SessionEdit } from '../utils/sessionEditHistory.js';

const DOWN_ARROW = String.fromCharCode(0x1b) + '[B';
const UP_ARROW = String.fromCharCode(0x1b) + '[A';
const ESCAPE = String.fromCharCode(0x1b);

function makeEdit(overrides: Partial<SessionEdit> = {}): SessionEdit {
  return {
    key: 'call-1',
    fileName: 'a.ts',
    filePath: '/repo/a.ts',
    fileDiff: '--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,2 @@\n-old\n+new\n+line2\n',
    isNewFile: false,
    addedLines: 2,
    removedLines: 1,
    ...overrides,
  };
}

async function pressKey(stdin: { write: (data: string) => void }, key: string) {
  await act(async () => {
    vi.advanceTimersByTime(100);
    stdin.write(key);
  });
}

describe('DiffReviewScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows an empty state when no edits have happened yet', async () => {
    const { lastFrame } = await renderWithProviders(
      <DiffReviewScreen
        edits={[]}
        onClose={vi.fn()}
        terminalWidth={100}
        terminalHeight={40}
      />,
    );
    expect(lastFrame()).toContain('No file edits have been made');
  });

  it('lists every edited file and shows the first file diff by default', async () => {
    const edits = [
      makeEdit({ key: 'call-1', fileName: 'a.ts' }),
      makeEdit({ key: 'call-2', fileName: 'b.ts' }),
    ];
    const { lastFrame } = await renderWithProviders(
      <DiffReviewScreen
        edits={edits}
        onClose={vi.fn()}
        terminalWidth={100}
        terminalHeight={40}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('a.ts');
    expect(frame).toContain('b.ts');
    expect(frame).toContain('new');
  });

  it('Down arrow moves the file selection and updates the diff panel', async () => {
    const edits = [
      makeEdit({
        key: 'call-1',
        fileName: 'a.ts',
        fileDiff: '--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-alpha\n+ALPHA\n',
      }),
      makeEdit({
        key: 'call-2',
        fileName: 'b.ts',
        fileDiff: '--- a/b.ts\n+++ b/b.ts\n@@ -1,1 +1,1 @@\n-beta\n+BETA\n',
      }),
    ];
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <DiffReviewScreen
        edits={edits}
        onClose={vi.fn()}
        terminalWidth={100}
        terminalHeight={40}
      />,
    );

    await waitUntilReady();
    expect(lastFrame()).toContain('ALPHA');

    await pressKey(stdin, DOWN_ARROW);
    await waitUntilReady();

    expect(lastFrame()).toContain('BETA');
  });

  it('Up arrow at the top stays on the first file', async () => {
    const edits = [
      makeEdit({
        key: 'call-1',
        fileName: 'a.ts',
        fileDiff: '--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-alpha\n+ALPHA\n',
      }),
      makeEdit({
        key: 'call-2',
        fileName: 'b.ts',
        fileDiff: '--- a/b.ts\n+++ b/b.ts\n@@ -1,1 +1,1 @@\n-beta\n+BETA\n',
      }),
    ];
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <DiffReviewScreen
        edits={edits}
        onClose={vi.fn()}
        terminalWidth={100}
        terminalHeight={40}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, UP_ARROW);
    await waitUntilReady();

    expect(lastFrame()).toContain('ALPHA');
    expect(lastFrame()).not.toContain('BETA');
  });

  it('Escape closes the screen', async () => {
    const onClose = vi.fn();
    const { stdin, waitUntilReady } = await renderWithProviders(
      <DiffReviewScreen
        edits={[makeEdit()]}
        onClose={onClose}
        terminalWidth={100}
        terminalHeight={40}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, ESCAPE);
    await waitUntilReady();

    expect(onClose).toHaveBeenCalled();
  });
});

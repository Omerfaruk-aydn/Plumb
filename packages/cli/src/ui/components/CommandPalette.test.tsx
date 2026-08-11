/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { act } from 'react';
import { CommandPalette } from './CommandPalette.js';
import { CommandKind, type SlashCommand } from '../commands/types.js';

const ENTER = String.fromCharCode(0x0d);
const UP_ARROW = String.fromCharCode(0x1b) + '[A';
const DOWN_ARROW = String.fromCharCode(0x1b) + '[B';
const ESCAPE = String.fromCharCode(0x1b);
const BACKSPACE = String.fromCharCode(0x7f);

function makeCommand(
  name: string,
  overrides: Partial<SlashCommand> = {},
): SlashCommand {
  return {
    name,
    description: `${name} description`,
    kind: CommandKind.BUILT_IN,
    ...overrides,
  };
}

async function pressKey(stdin: { write: (data: string) => void }, key: string) {
  await act(async () => {
    vi.advanceTimersByTime(100);
    stdin.write(key);
  });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const commands: SlashCommand[] = [
    makeCommand('help'),
    makeCommand('theme'),
    makeCommand('clear'),
    makeCommand('secret', { hidden: true }),
  ];

  it('renders every non-hidden command when the query is empty', async () => {
    const { lastFrame } = await renderWithProviders(
      <CommandPalette
        commands={commands}
        onExecute={vi.fn()}
        onClose={vi.fn()}
        terminalWidth={100}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('/help');
    expect(frame).toContain('/theme');
    expect(frame).toContain('/clear');
    expect(frame).not.toContain('/secret');
  });

  it('filters commands by fuzzy query as the user types', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <CommandPalette
        commands={commands}
        onExecute={vi.fn()}
        onClose={vi.fn()}
        terminalWidth={100}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, 'the');
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('/theme');
    expect(frame).not.toContain('/help');
    expect(frame).not.toContain('/clear');
  });

  it('shows an empty-results message when nothing matches', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <CommandPalette
        commands={commands}
        onExecute={vi.fn()}
        onClose={vi.fn()}
        terminalWidth={100}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, 'zzz');
    await waitUntilReady();

    expect(lastFrame()).toContain('No matching commands.');
  });

  it('Enter executes the highlighted (first) command', async () => {
    const onExecute = vi.fn();
    const { stdin, waitUntilReady } = await renderWithProviders(
      <CommandPalette
        commands={commands}
        onExecute={onExecute}
        onClose={vi.fn()}
        terminalWidth={100}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    expect(onExecute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'help' }),
    );
  });

  it('Down arrow moves the selection before Enter executes', async () => {
    const onExecute = vi.fn();
    const { stdin, waitUntilReady } = await renderWithProviders(
      <CommandPalette
        commands={commands}
        onExecute={onExecute}
        onClose={vi.fn()}
        terminalWidth={100}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, DOWN_ARROW);
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    expect(onExecute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'theme' }),
    );
  });

  it('Up arrow at the top of the list does not go negative (still runs the first item)', async () => {
    const onExecute = vi.fn();
    const { stdin, waitUntilReady } = await renderWithProviders(
      <CommandPalette
        commands={commands}
        onExecute={onExecute}
        onClose={vi.fn()}
        terminalWidth={100}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, UP_ARROW);
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    expect(onExecute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'help' }),
    );
  });

  it('Escape closes the palette', async () => {
    const onClose = vi.fn();
    const { stdin, waitUntilReady } = await renderWithProviders(
      <CommandPalette
        commands={commands}
        onExecute={vi.fn()}
        onClose={onClose}
        terminalWidth={100}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, ESCAPE);
    await waitUntilReady();

    expect(onClose).toHaveBeenCalled();
  });

  it('Backspace removes the last query character and re-filters', async () => {
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <CommandPalette
        commands={commands}
        onExecute={vi.fn()}
        onClose={vi.fn()}
        terminalWidth={100}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, 'thex');
    await waitUntilReady();
    expect(lastFrame()).toContain('No matching commands.');

    await pressKey(stdin, BACKSPACE);
    await waitUntilReady();
    expect(lastFrame()).toContain('/theme');
  });

  it('resets the selection to the top when the query changes', async () => {
    const onExecute = vi.fn();
    const { stdin, waitUntilReady } = await renderWithProviders(
      <CommandPalette
        commands={commands}
        onExecute={onExecute}
        onClose={vi.fn()}
        terminalWidth={100}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, DOWN_ARROW);
    // Narrow the query -- selection should reset to index 0 of the new results.
    await pressKey(stdin, 'c');
    await pressKey(stdin, ENTER);
    await waitUntilReady();

    expect(onExecute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'clear' }),
    );
  });
});

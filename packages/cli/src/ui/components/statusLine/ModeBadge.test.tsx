/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../../test-utils/render.js';
import { ModeBadge, type InputMode } from './ModeBadge.js';

describe('ModeBadge', () => {
  it('renders a bare chevron in the default prompt mode', async () => {
    // A badge on every line is noise: "no special mode" is the absence of
    // a signal, not a signal of its own.
    const { lastFrame, unmount } = await renderWithProviders(
      <ModeBadge mode="prompt" />,
      { width: 20 },
    );

    const frame = lastFrame();
    expect(frame).toContain('❯');
    expect(frame).not.toContain('!');
    expect(frame).not.toContain('*');
    unmount();
  });

  it.each<[InputMode, string]>([
    ['shell', '!'],
    ['yolo', '*'],
    ['plan', 'P'],
    ['accept', 'A'],
    ['search', '⌕'],
  ])('renders a distinct filled tag for %s mode', async (mode, glyph) => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ModeBadge mode={mode} />,
      { width: 20 },
    );

    const frame = lastFrame();
    expect(frame).toContain(glyph);
    // The tag replaces the chevron rather than preceding it: the prefix
    // must stay exactly two columns wide (InputPrompt budgets layout
    // against PROMPT_PREFIX_WIDTH), so the caret never shifts by mode.
    expect(frame.replace(/\s/g, '').length).toBe(1);
    unmount();
  });

  it('gives every mode its own glyph, so none is mistakable for another', async () => {
    const modes: InputMode[] = ['shell', 'yolo', 'plan', 'accept', 'search'];
    const glyphs = new Set<string>();

    for (const mode of modes) {
      const { lastFrame, unmount } = await renderWithProviders(
        <ModeBadge mode={mode} />,
        { width: 20 },
      );
      glyphs.add(lastFrame().replace(/\s/g, ''));
      unmount();
    }

    expect(glyphs.size).toBe(modes.length);
  });
});

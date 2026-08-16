/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { Text } from 'ink';
import { renderWithProviders } from '../../../test-utils/render.js';
import { PowerlineRow, type PowerlineSegment } from './PowerlineRow.js';
import { resolveSeparator, SEPARATORS } from './separators.js';

function segment(
  key: string,
  label: string,
  priority: number,
  color = '#00AFAF',
): PowerlineSegment {
  return {
    key,
    element: <Text>{label}</Text>,
    color,
    width: label.length,
    priority,
  };
}

describe('PowerlineRow', () => {
  it('renders every segment when the row fits', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <PowerlineRow
        left={[segment('a', 'alpha', 10), segment('b', 'beta', 9)]}
        right={[segment('c', 'gamma', 8)]}
        separator={SEPARATORS['powerline-thin']}
        terminalWidth={80}
      />,
      { width: 80 },
    );

    const frame = lastFrame();
    expect(frame).toContain('alpha');
    expect(frame).toContain('beta');
    expect(frame).toContain('gamma');
    unmount();
  });

  it('drops the lowest-priority field first when the row cannot fit', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <PowerlineRow
        // 'keep' outranks 'drop'; only one can survive at this width.
        left={[segment('keep', 'IMPORTANT', 100), segment('drop', 'minor', 1)]}
        right={[]}
        separator={SEPARATORS['powerline-thin']}
        terminalWidth={14}
      />,
      { width: 14 },
    );

    const frame = lastFrame();
    expect(frame).toContain('IMPORTANT');
    expect(frame).not.toContain('minor');
    unmount();
  });

  it('never drops the last remaining field, however narrow the terminal', async () => {
    // A status line that renders nothing is worse than one that overflows:
    // the user loses the "what am I talking to" anchor entirely.
    const { lastFrame, unmount } = await renderWithProviders(
      <PowerlineRow
        left={[segment('only', 'sonnet-5', 100)]}
        right={[]}
        separator={SEPARATORS['powerline-thin']}
        terminalWidth={4}
      />,
      { width: 4 },
    );

    expect(lastFrame()).toContain('s');
    unmount();
  });

  it('sheds from the side holding the least important field, not always the right', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <PowerlineRow
        left={[segment('cheap', 'xx', 1)]}
        right={[segment('dear', 'MODEL', 100)]}
        separator={SEPARATORS['powerline-thin']}
        terminalWidth={10}
      />,
      { width: 10 },
    );

    const frame = lastFrame();
    expect(frame).toContain('MODEL');
    expect(frame).not.toContain('xx');
    unmount();
  });
});

describe('resolveSeparator', () => {
  it('keeps Nerd Font powerline glyphs when the font is confirmed', () => {
    const spec = resolveSeparator('powerline', true);
    expect(spec.left).toBe(SEPARATORS.powerline.left);
    expect(spec.chainsColor).toBe(true);
  });

  it('substitutes geometric shapes for powerline when Nerd Font is not confirmed', () => {
    // Emitting private-use codepoints into a font that lacks them renders
    // a row of replacement boxes -- strictly worse than a plain arrow.
    const spec = resolveSeparator('powerline', false);
    expect(spec.left).toBe('▶');
    expect(spec.right).toBe('◀');
    // Downgrading the glyph must not change how color flows across it.
    expect(spec.chainsColor).toBe(true);
    expect(spec.filled).toBe(true);
  });

  it('leaves non-powerline styles untouched regardless of font support', () => {
    for (const style of ['slash', 'pipe', 'block', 'dot', 'ascii'] as const) {
      expect(resolveSeparator(style, false)).toEqual(SEPARATORS[style]);
      expect(resolveSeparator(style, true)).toEqual(SEPARATORS[style]);
    }
  });
});

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F20 (PLUMB-UI-DEVRIM-PROMPT.md): adaptive (auto/stacked/split) diff layout.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  resolveDiffLayout,
  buildSplitRows,
  truncateToWidth,
  parseDiffWithLineNumbers,
  DiffRenderer,
} from './DiffRenderer.js';
import { OverflowProvider } from '../../contexts/OverflowContext.js';
import { renderWithProviders } from '../../../test-utils/render.js';
import { createMockSettings } from '../../../test-utils/settings.js';
import { waitFor } from '../../../test-utils/async.js';

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return { ...actual, useIsScreenReaderEnabled: vi.fn(() => false) };
});

const MULTI_LINE_DIFF = `
diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -1,4 +1,4 @@
 unchanged line
-old line one
-old line two
+new line one
+new line two
 trailing context
`;

describe('resolveDiffLayout (F20 threshold)', () => {
  it('goes split at exactly 120 columns and stacked at 119 in auto mode', () => {
    expect(resolveDiffLayout('auto', 120, false)).toBe('split');
    expect(resolveDiffLayout('auto', 119, false)).toBe('stacked');
  });

  it('forces stacked regardless of width when the setting says stacked', () => {
    expect(resolveDiffLayout('stacked', 200, false)).toBe('stacked');
  });

  it('forces split regardless of width when the setting says split', () => {
    expect(resolveDiffLayout('split', 40, false)).toBe('split');
  });

  it('always stays stacked for a screen reader, even at a wide width or split setting', () => {
    expect(resolveDiffLayout('split', 200, true)).toBe('stacked');
    expect(resolveDiffLayout('auto', 200, true)).toBe('stacked');
  });

  it('defaults to auto behavior when the setting is undefined', () => {
    expect(resolveDiffLayout(undefined, 200, false)).toBe('split');
    expect(resolveDiffLayout(undefined, 40, false)).toBe('stacked');
  });
});

describe('buildSplitRows (old/new pairing)', () => {
  it('pairs consecutive del/add runs row by row and mirrors context onto both sides', () => {
    const parsed = parseDiffWithLineNumbers(MULTI_LINE_DIFF);
    const displayable = parsed.filter(
      (l) => l.type !== 'hunk' && l.type !== 'other',
    );
    const rows = buildSplitRows(displayable);

    expect(rows[0]).toEqual({
      left: { lineNumber: 1, content: 'unchanged line', type: 'context' },
      right: { lineNumber: 1, content: 'unchanged line', type: 'context' },
    });
    expect(rows[1].left).toEqual({
      lineNumber: 2,
      content: 'old line one',
      type: 'del',
    });
    expect(rows[1].right).toEqual({
      lineNumber: 2,
      content: 'new line one',
      type: 'add',
    });
    expect(rows[2].left).toEqual({
      lineNumber: 3,
      content: 'old line two',
      type: 'del',
    });
    expect(rows[2].right).toEqual({
      lineNumber: 3,
      content: 'new line two',
      type: 'add',
    });
    expect(rows[3]).toEqual({
      left: { lineNumber: 4, content: 'trailing context', type: 'context' },
      right: { lineNumber: 4, content: 'trailing context', type: 'context' },
    });
  });

  it('leaves the opposite side blank when del/add counts are unequal', () => {
    const parsed = parseDiffWithLineNumbers(`
diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -1,2 +1,3 @@
-removed only
+added one
+added two
`);
    const displayable = parsed.filter(
      (l) => l.type !== 'hunk' && l.type !== 'other',
    );
    const rows = buildSplitRows(displayable);

    expect(rows[0].left?.type).toBe('del');
    expect(rows[0].right?.type).toBe('add');
    expect(rows[1].left).toBeUndefined();
    expect(rows[1].right?.type).toBe('add');
  });
});

describe('truncateToWidth', () => {
  it('leaves short content untouched', () => {
    expect(truncateToWidth('short', 20)).toBe('short');
  });

  it('truncates long content with an ellipsis instead of wrapping', () => {
    const long = 'x'.repeat(50);
    const result = truncateToWidth(long, 10);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(10);
  });
});

describe('DiffRenderer live width switch (resize)', () => {
  it('renders the same diff as split at 140 columns and stacked at 100, with no content loss', async () => {
    const settings = createMockSettings({ ui: { diffStyle: 'auto' } });

    const wide = await renderWithProviders(
      <OverflowProvider>
        <DiffRenderer diffContent={MULTI_LINE_DIFF} terminalWidth={140} />
      </OverflowProvider>,
      { settings },
    );
    await waitFor(() => expect(wide.lastFrame()).toBeTruthy());
    const wideFrame = wide.lastFrame() ?? '';
    expect(wideFrame).toContain('│');
    expect(wideFrame).toContain('new line one');
    expect(wideFrame).toContain('old line one');

    const narrow = await renderWithProviders(
      <OverflowProvider>
        <DiffRenderer diffContent={MULTI_LINE_DIFF} terminalWidth={100} />
      </OverflowProvider>,
      { settings },
    );
    await waitFor(() => expect(narrow.lastFrame()).toBeTruthy());
    const narrowFrame = narrow.lastFrame() ?? '';
    expect(narrowFrame).not.toContain('│');
    expect(narrowFrame).toContain('new line one');
    expect(narrowFrame).toContain('old line one');
  });

  it('honors an explicit "split" setting even below the auto threshold', async () => {
    const settings = createMockSettings({ ui: { diffStyle: 'split' } });
    const result = await renderWithProviders(
      <OverflowProvider>
        <DiffRenderer diffContent={MULTI_LINE_DIFF} terminalWidth={80} />
      </OverflowProvider>,
      { settings },
    );
    await waitFor(() => expect(result.lastFrame()).toBeTruthy());
    expect(result.lastFrame()).toContain('│');
  });

  it('stays stacked for a screen reader even with diffStyle: split at a wide width', async () => {
    const { useIsScreenReaderEnabled } = await import('ink');
    vi.mocked(useIsScreenReaderEnabled).mockReturnValue(true);

    const settings = createMockSettings({ ui: { diffStyle: 'split' } });
    const result = await renderWithProviders(
      <OverflowProvider>
        <DiffRenderer diffContent={MULTI_LINE_DIFF} terminalWidth={200} />
      </OverflowProvider>,
      { settings },
    );
    await waitFor(() => expect(result.lastFrame()).toBeTruthy());
    expect(result.lastFrame()).not.toContain('│');

    vi.mocked(useIsScreenReaderEnabled).mockReturnValue(false);
  });
});

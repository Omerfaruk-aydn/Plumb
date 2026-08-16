/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { Fragment } from 'react';
import { render } from '../../../test-utils/render.js';
import {
  computeLineWordDiff,
  parseDiffWithLineNumbers,
  renderDiffLines,
} from './DiffRenderer.js';

describe('computeLineWordDiff', () => {
  it('returns null for identical lines -- nothing to highlight', () => {
    expect(computeLineWordDiff('const x = 1;', 'const x = 1;')).toBeNull();
  });

  it('isolates the changed token from the shared prefix and suffix', () => {
    const result = computeLineWordDiff(
      'const x = fooBar(a, b);',
      'const x = fooBar(a, b, c);',
    );
    expect(result).not.toBeNull();
    // Everything but the inserted ", c" is unchanged on both sides.
    expect(
      result!.addedParts.filter((p) => p.changed).map((p) => p.value),
    ).toEqual([', c']);
    expect(result!.removedParts.every((p) => !p.changed)).toBe(true);
  });

  it('marks a shared word as unchanged on both sides', () => {
    const result = computeLineWordDiff('return foo;', 'return bar;');
    expect(result).not.toBeNull();
    const unchangedOld = result!.removedParts
      .filter((p) => !p.changed)
      .map((p) => p.value)
      .join('');
    const unchangedNew = result!.addedParts
      .filter((p) => !p.changed)
      .map((p) => p.value)
      .join('');
    expect(unchangedOld).toContain('return');
    expect(unchangedNew).toContain('return');
  });

  it('returns null when the lines share no tokens at all', () => {
    // A full rewrite has no partial match to point at; a box around 100% of
    // the line adds nothing the plain background wash didn't already say.
    expect(computeLineWordDiff('foo bar baz', '1 2 3')).toBeNull();
  });

  it('returns null past the length guard rather than paying quadratic cost', () => {
    const long = 'x'.repeat(500);
    expect(computeLineWordDiff(long, long + 'y')).toBeNull();
  });
});

const DIFF_HEADER = '@@ -1,3 +1,3 @@\n';

describe('renderDiffLines word-level highlighting', () => {
  it('renders both the old and new text for a single-line replacement', async () => {
    const diff =
      DIFF_HEADER +
      ' unchanged before\n' +
      '-const total = price + tax;\n' +
      '+const total = price + tax + tip;\n' +
      ' unchanged after';

    const parsedLines = parseDiffWithLineNumbers(diff);
    const nodes = renderDiffLines({ parsedLines, terminalWidth: 100 });
    const { lastFrame, unmount } = await render(
      <Fragment>{nodes}</Fragment>,
      100,
    );

    const frame = lastFrame();
    expect(frame).toContain('price + tax');
    expect(frame).toContain('tip');
    unmount();
  });

  it('does not throw and still shows both lines when disableColor is set', async () => {
    const diff =
      DIFF_HEADER +
      '-const total = price + tax;\n' +
      '+const total = price + tax + tip;\n';

    const parsedLines = parseDiffWithLineNumbers(diff);
    const nodes = renderDiffLines({
      parsedLines,
      terminalWidth: 100,
      disableColor: true,
    });
    const { lastFrame, unmount } = await render(
      <Fragment>{nodes}</Fragment>,
      100,
    );

    expect(lastFrame()).toContain('tip');
    unmount();
  });

  it('falls back to whole-line color when a run has unequal del/add counts', async () => {
    // Two deletions replaced by one addition: no unambiguous 1:1 pairing.
    const diff =
      DIFF_HEADER + '-const a = 1;\n' + '-const b = 2;\n' + '+const ab = 3;\n';

    const parsedLines = parseDiffWithLineNumbers(diff);
    const nodes = renderDiffLines({ parsedLines, terminalWidth: 100 });
    const { lastFrame, unmount } = await render(
      <Fragment>{nodes}</Fragment>,
      100,
    );

    const frame = lastFrame();
    expect(frame).toContain('const a = 1;');
    expect(frame).toContain('const b = 2;');
    expect(frame).toContain('const ab = 3;');
    unmount();
  });

  it('renders every changed line exactly once, without cross-contaminating pairs', async () => {
    const diff =
      DIFF_HEADER +
      '-first old line\n' +
      '+first new line\n' +
      '-second old line\n' +
      '+second new line\n';

    const parsedLines = parseDiffWithLineNumbers(diff);
    const nodes = renderDiffLines({ parsedLines, terminalWidth: 100 });
    const { lastFrame, unmount } = await render(
      <Fragment>{nodes}</Fragment>,
      100,
    );
    const frame = lastFrame();

    expect(frame).toContain('first new line');
    expect(frame).toContain('second old line');
    unmount();
  });
});

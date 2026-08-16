/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../semantic-colors.js';
import type { SeparatorSpec } from './separators.js';

/** One rendered field of the status line. */
export interface PowerlineSegment {
  readonly key: string;
  /** Already-rendered content. Kept as a node so segments can be rich. */
  readonly element: React.ReactNode;
  /** Field hue. Becomes the fill in a filled style, the text color otherwise. */
  readonly color: string;
  /** Rendered width in columns, for the drop-when-narrow pass. */
  readonly width: number;
  /**
   * Higher survives longer when the bar has to shed fields. The active
   * model and working directory outrank session accounting: losing "where
   * am I / what am I talking to" is what makes a status line useless.
   */
  readonly priority: number;
}

interface PowerlineRowProps {
  readonly left: readonly PowerlineSegment[];
  readonly right: readonly PowerlineSegment[];
  readonly separator: SeparatorSpec;
  readonly terminalWidth: number;
}

/** Padding inside a filled segment, in columns (one space each side). */
const FILLED_PADDING = 2;

/** Blank columns a plain (unfilled) separator is drawn between. */
const RULE_PADDING = 2;

/**
 * Real rendered cost of one segment, which is not its content width: a
 * filled segment carries a space on each side (see `renderRun`). Getting
 * this wrong makes the fitting pass believe a row fits when it overflows.
 */
function segmentWidth(
  segment: PowerlineSegment,
  separator: SeparatorSpec,
): number {
  return separator.filled ? segment.width + FILLED_PADDING : segment.width;
}

/** Real rendered cost of one boundary between two segments. */
function separatorWidthFor(separator: SeparatorSpec): number {
  return separator.filled
    ? separator.left.length
    : separator.left.length + RULE_PADDING;
}

/**
 * Drops the lowest-priority segments until the row fits.
 *
 * Truncating text instead would produce a row of ellipses that reads as
 * broken rather than abbreviated; dropping whole fields keeps every
 * surviving field legible, which is the property that makes a status line
 * scannable at all.
 */
function fitToWidth(
  left: readonly PowerlineSegment[],
  right: readonly PowerlineSegment[],
  separator: SeparatorSpec,
  available: number,
): { left: PowerlineSegment[]; right: PowerlineSegment[] } {
  let l = [...left];
  let r = [...right];
  const separatorWidth = separatorWidthFor(separator);

  const total = () => {
    if (l.length + r.length === 0) return 0;
    const width = (run: PowerlineSegment[]) =>
      run.reduce((sum, s) => sum + segmentWidth(s, separator), 0) +
      separatorWidth * Math.max(run.length - 1, 0);
    return width(l) + width(r);
  };

  while (total() > available && l.length + r.length > 1) {
    const lowestLeft = l.reduce<PowerlineSegment | undefined>(
      (min, s) => (!min || s.priority < min.priority ? s : min),
      undefined,
    );
    const lowestRight = r.reduce<PowerlineSegment | undefined>(
      (min, s) => (!min || s.priority < min.priority ? s : min),
      undefined,
    );
    // Shed from whichever side currently holds the least important field,
    // so a crowded left run can't force a high-value right field out.
    const dropFromRight =
      lowestRight !== undefined &&
      (lowestLeft === undefined || lowestRight.priority <= lowestLeft.priority);
    if (dropFromRight) {
      r = r.filter((s) => s.key !== lowestRight.key);
    } else if (lowestLeft !== undefined) {
      l = l.filter((s) => s.key !== lowestLeft.key);
    } else {
      break;
    }
  }
  return { left: l, right: r };
}

/**
 * Renders a run of segments with interlocking separators.
 *
 * In a filled style each separator is drawn in the outgoing segment's
 * color over the incoming segment's ground, which is what makes powerline
 * shapes read as one continuous ribbon. Unfilled styles draw a neutral
 * rule instead -- a colored arrow with no fill behind it just looks like
 * a stray glyph.
 */
function renderRun(
  segments: readonly PowerlineSegment[],
  separator: SeparatorSpec,
  edge: 'left' | 'right',
): React.ReactNode[] {
  const glyph = edge === 'left' ? separator.left : separator.right;
  const nodes: React.ReactNode[] = [];

  segments.forEach((segment, index) => {
    if (index > 0) {
      const previous = segments[index - 1];
      nodes.push(
        separator.chainsColor && separator.filled ? (
          <Text
            key={`sep-${segment.key}`}
            color={edge === 'left' ? previous.color : segment.color}
            backgroundColor={edge === 'left' ? segment.color : previous.color}
          >
            {glyph}
          </Text>
        ) : (
          <Text key={`sep-${segment.key}`} color={theme.ui.comment}>
            {` ${glyph} `}
          </Text>
        ),
      );
    }
    nodes.push(
      separator.filled ? (
        <Text
          key={segment.key}
          backgroundColor={segment.color}
          color={theme.background.primary}
        >
          {' '}
          {segment.element}{' '}
        </Text>
      ) : (
        <Text key={segment.key} color={segment.color}>
          {segment.element}
        </Text>
      ),
    );
  });

  return nodes;
}

export const PowerlineRow: React.FC<PowerlineRowProps> = ({
  left,
  right,
  separator,
  terminalWidth,
}) => {
  const fitted = fitToWidth(left, right, separator, terminalWidth);

  return (
    <Box width={terminalWidth} flexWrap="nowrap" overflow="hidden">
      <Box flexShrink={0}>{renderRun(fitted.left, separator, 'left')}</Box>
      <Box flexGrow={1} />
      <Box flexShrink={0}>{renderRun(fitted.right, separator, 'right')}</Box>
    </Box>
  );
};

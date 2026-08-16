/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../semantic-colors.js';
import {
  fitPills,
  sampleGradient,
  MAX_MARKS,
  type Pill,
  type PillId,
} from './pillLayout.js';

/** The glyph repeated once per queued message, ramped across the gradient. */
const QUEUE_MARK = '▶';

export interface PillStripProps {
  readonly pills: readonly Pill[];
  /** Columns the strip may occupy, already net of `marginLeft`. */
  readonly availableWidth: number;
  /**
   * Indent, owned here rather than by a wrapper Box in the caller: an empty
   * wrapper still costs a row, and this strip's whole point is to disappear
   * completely when there is nothing in flight.
   */
  readonly marginLeft?: number;
}

interface PillTone {
  /** Ground of the tag block; the tag text is knocked out of it. */
  readonly tag: string;
  /** Ground of the value block -- quieter, so the tag leads. */
  readonly value: string;
  /** Ink for the value block. */
  readonly valueText: string;
}

function toneFor(id: PillId): PillTone {
  switch (id) {
    case 'todo':
      return {
        tag: theme.text.accent,
        value: theme.background.message,
        valueText: theme.text.primary,
      };
    case 'queue':
      // Queued work is deferred, not active: a warning ground would claim
      // something is wrong, and nothing is -- the user simply typed ahead.
      return {
        tag: theme.text.link,
        value: theme.background.message,
        valueText: theme.text.primary,
      };
    default:
      return {
        tag: theme.ui.comment,
        value: theme.background.message,
        valueText: theme.text.primary,
      };
  }
}

const PillMarks: React.FC<{ count: number; fallback: string }> = ({
  count,
  fallback,
}) => {
  const colors = useMemo(
    () =>
      sampleGradient(theme.ui.gradient, Math.min(count, MAX_MARKS), fallback),
    [count, fallback],
  );

  if (colors.length === 0) return null;

  return (
    <Text>
      {colors.map((color, index) => (
        <Text key={index} color={color}>
          {QUEUE_MARK}
        </Text>
      ))}{' '}
    </Text>
  );
};

const PillView: React.FC<{ pill: Pill }> = ({ pill }) => {
  const tone = toneFor(pill.id);

  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text backgroundColor={tone.tag} color={theme.background.primary} bold>
        {` ${pill.tag} `}
      </Text>
      <Text backgroundColor={tone.value} color={tone.valueText}>
        {' '}
        <PillMarks count={pill.marks} fallback={tone.valueText} />
        {pill.value}{' '}
      </Text>
      {pill.detail ? (
        // `truncate` rather than a wrap: fitPills has already sized this to
        // the row, and if a rounding error ever left it one column over, a
        // clipped word costs less than a second row appearing under the
        // prompt and shoving the whole composer up.
        <Text color={theme.text.secondary} wrap="truncate">
          {' '}
          {pill.detail}
        </Text>
      ) : null}
    </Box>
  );
};

/**
 * One row of pills describing work that is in flight right now.
 *
 * Renders nothing when there is nothing in flight -- an empty row above the
 * prompt is a line of screen the user paid for and got nothing back.
 */
export const PillStrip: React.FC<PillStripProps> = ({
  pills,
  availableWidth,
  marginLeft = 0,
}) => {
  const fitted = useMemo(
    () => fitPills(pills, availableWidth),
    [pills, availableWidth],
  );

  if (fitted.length === 0) return null;

  return (
    <Box
      flexDirection="row"
      columnGap={1}
      marginLeft={marginLeft}
      width={availableWidth}
      height={1}
      overflow="hidden"
    >
      {fitted.map((pill) => (
        <PillView key={pill.id} pill={pill} />
      ))}
    </Box>
  );
};

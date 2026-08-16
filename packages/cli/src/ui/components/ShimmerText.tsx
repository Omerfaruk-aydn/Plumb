/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text, useIsScreenReaderEnabled } from 'ink';
import { theme } from '../semantic-colors.js';
import { useShimmer } from '../hooks/useShimmer.js';

interface ShimmerTextProps {
  text: string;
  /**
   * Drives the animation. Pass the real "is something happening" state --
   * a shimmer on settled text reads as a rendering bug, not as polish.
   */
  active: boolean;
  italic?: boolean;
}

/**
 * Text with a light band sweeping across it, as oh-my-pi does for its
 * in-progress labels (packages/coding-agent/src/modes/theme/shimmer.ts).
 * Conveys "working" along the whole label, where a spinner conveys it at
 * one fixed point on the line.
 *
 * Falls back to flat accent text when inactive, under NO_COLOR, or with a
 * screen reader attached -- the sweep carries no information a reader
 * could use, and per-frame color churn is hostile to one.
 *
 * Mocked suite-wide in tests (see test-utils/mockShimmer.tsx); this runs a
 * 30fps timer and mounts on a component that renders constantly.
 */
export const ShimmerText: React.FC<ShimmerTextProps> = ({
  text,
  active,
  italic,
}) => {
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  const enabled = active && !isScreenReaderEnabled && !process.env['NO_COLOR'];
  const segments = useShimmer(text, enabled);

  if (!enabled) {
    return (
      <Text color={theme.text.accent} italic={italic} wrap="truncate-end">
        {text}
      </Text>
    );
  }

  return (
    <Text italic={italic} wrap="truncate-end">
      {segments.map((segment, index) => (
        <Text
          key={index}
          color={
            segment.tier === 'high'
              ? theme.text.primary
              : segment.tier === 'mid'
                ? theme.text.accent
                : theme.text.secondary
          }
          bold={segment.tier === 'high'}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  );
};

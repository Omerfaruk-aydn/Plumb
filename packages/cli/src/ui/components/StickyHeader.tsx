/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, type DOMElement } from 'ink';
import { theme } from '../semantic-colors.js';

export interface StickyHeaderProps {
  children: React.ReactNode;
  width: number;
  isFirst: boolean;
  borderColor: string;
  borderDimColor: boolean;
  containerRef?: React.RefObject<DOMElement | null>;
  /**
   * 'boxed' draws the original three-sided rounded header (used by
   * confirmation dialogs, where a genuine box is the point). 'rule' drops
   * the right edge and switches to a single-line style, so the header caps
   * a left-hand rule rather than the top of a box -- a tool call is ambient
   * activity the user is watching happen, not a modal the box implied.
   * Defaults to 'boxed' so existing callers are unaffected.
   */
  variant?: 'boxed' | 'rule';
}

export const StickyHeader: React.FC<StickyHeaderProps> = ({
  children,
  width,
  isFirst,
  borderColor,
  borderDimColor,
  containerRef,
  variant = 'boxed',
}) => {
  const isRule = variant === 'rule';

  return (
    <Box
      ref={containerRef}
      sticky
      minHeight={1}
      flexShrink={0}
      width={width}
      stickyChildren={
        <Box
          borderStyle={isRule ? 'single' : 'round'}
          flexDirection="column"
          width={width}
          opaque
          borderColor={borderColor}
          borderDimColor={borderDimColor}
          borderBottom={false}
          borderRight={!isRule}
          borderTop={isFirst}
          paddingTop={isFirst ? 0 : 1}
        >
          <Box paddingX={1}>{children}</Box>
          {/* Dark border to separate header from content. */}
          <Box
            width={width - 2}
            borderColor={theme.ui.dark}
            borderStyle="single"
            borderTop={false}
            borderBottom={true}
            borderLeft={false}
            borderRight={false}
          ></Box>
        </Box>
      }
    >
      <Box
        borderStyle={isRule ? 'single' : 'round'}
        width={width}
        borderColor={borderColor}
        borderDimColor={borderDimColor}
        borderBottom={false}
        borderTop={isFirst}
        borderLeft={true}
        borderRight={!isRule}
        paddingX={1}
        paddingBottom={1}
        paddingTop={isFirst ? 0 : 1}
      >
        {children}
      </Box>
    </Box>
  );
};

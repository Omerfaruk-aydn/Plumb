/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box } from 'ink';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { theme } from '../../semantic-colors.js';
import { useUIState } from '../../contexts/UIStateContext.js';
import { GradientStreamCursor } from '../GradientStreamCursor.js';

interface PlumbMessageContentProps {
  text: string;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

/*
 * Gemini message content is a semi-hacked component. The intention is to represent a partial
 * of PlumbMessage and is only used when a response gets too long. In that instance messages
 * are split into multiple PlumbMessageContent's to enable the root <Static> component in
 * App.tsx to be as performant as humanly possible.
 */
export const PlumbMessageContent: React.FC<PlumbMessageContentProps> = ({
  text,
  isPending,
  availableTerminalHeight,
  terminalWidth,
}) => {
  const { renderMarkdown } = useUIState();
  const originalPrefix = '✦ ';
  const prefixWidth = originalPrefix.length;
  // F4: matches PlumbMessage.tsx's left border strip so a split message
  // (see this file's own comment above) still reads as one continuous
  // bubble across chunks. PlumbMessage's content starts after
  // border(1) + paddingLeft(1) + prefix box(prefixWidth) columns, so
  // this box's own border(1) + paddingLeft must add up to the same
  // prefixWidth + 1 total before content begins.
  const leftPadding = prefixWidth + 1;
  const contentWidth = Math.max(terminalWidth - leftPadding - 1, 0);

  return (
    <Box
      flexDirection="column"
      paddingLeft={leftPadding}
      borderStyle="single"
      borderTop={false}
      borderBottom={false}
      borderRight={false}
      borderColor={theme.border.default}
    >
      <MarkdownDisplay
        text={text}
        isPending={isPending}
        availableTerminalHeight={
          availableTerminalHeight === undefined
            ? undefined
            : Math.max(availableTerminalHeight - 1, 1)
        }
        terminalWidth={contentWidth}
        renderMarkdown={renderMarkdown}
      />
      {isPending && <GradientStreamCursor />}
    </Box>
  );
};

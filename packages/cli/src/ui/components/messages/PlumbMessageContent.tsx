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
  // Card treatment: each split chunk (see this file's own comment above)
  // is its own full rounded box, matching PlumbMessage.tsx, rather than
  // trying to fake one continuous bubble across a <Static>-forced split
  // via matched left-padding -- with real borders on all four sides that
  // illusion doesn't hold anyway, so a very long response now reads as a
  // short run of consecutive accent-bordered cards instead.
  const borderOverhead = 2; // 1 border col + 1 padding col, each side
  const contentWidth = Math.max(terminalWidth - borderOverhead, 0);

  return (
    <Box flexDirection="column" marginY={1} alignSelf="flex-start">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.text.accent}
        paddingX={1}
        width={terminalWidth}
      >
        <MarkdownDisplay
          text={text}
          isPending={isPending}
          availableTerminalHeight={
            availableTerminalHeight === undefined
              ? undefined
              : Math.max(availableTerminalHeight - 3, 1)
          }
          terminalWidth={contentWidth}
          renderMarkdown={renderMarkdown}
        />
        {isPending && <GradientStreamCursor />}
      </Box>
    </Box>
  );
};

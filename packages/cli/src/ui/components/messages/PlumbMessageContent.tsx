/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box } from 'ink';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
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
  // Matches PlumbMessage.tsx's bare-indent layout so a split response (see
  // this file's own comment above) reads as one continuous block: the same
  // total left offset, minus the '✦ ' prefix box the first chunk carries.
  const leftPadding = 4; // PlumbMessage: paddingLeft(2) + prefix width(2)
  const contentWidth = Math.max(terminalWidth - leftPadding, 0);

  return (
    <Box flexDirection="column" paddingLeft={leftPadding}>
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

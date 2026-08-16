/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text, Box } from 'ink';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { theme } from '../../semantic-colors.js';
import { SCREEN_READER_MODEL_PREFIX } from '../../textConstants.js';
import { useUIState } from '../../contexts/UIStateContext.js';
import { GradientStreamCursor } from '../GradientStreamCursor.js';

interface PlumbMessageProps {
  text: string;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

export const PlumbMessage: React.FC<PlumbMessageProps> = ({
  text,
  isPending,
  availableTerminalHeight,
  terminalWidth,
}) => {
  const { renderMarkdown } = useUIState();
  const prefix = '✦ ';
  const prefixWidth = prefix.length;
  // Card treatment (Crush/opencode style): a full rounded box, matching
  // UserMessage, replaces the old left-border-only "bubble" strip.
  // borderOverhead is 4 (1 border col + 1 padding col, each side); height
  // loses 2 rows to the top/bottom border on top of the pre-existing -1
  // for the streaming cursor's own line.
  const borderOverhead = 4;
  const contentWidth = Math.max(
    terminalWidth - prefixWidth - borderOverhead,
    0,
  );

  return (
    <Box flexDirection="column" marginY={1} alignSelf="flex-start">
      <Box
        flexDirection="row"
        borderStyle="round"
        borderColor={theme.text.accent}
        paddingX={1}
        width={terminalWidth}
      >
        <Box width={prefixWidth}>
          <Text
            color={theme.text.accent}
            bold
            aria-label={SCREEN_READER_MODEL_PREFIX}
          >
            {prefix}
          </Text>
        </Box>
        <Box flexGrow={1} flexDirection="column">
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
    </Box>
  );
};

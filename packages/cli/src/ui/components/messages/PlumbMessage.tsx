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
  // Crush renders an unfocused assistant turn as bare indented prose --
  // `s.Messages.AssistantBlurred = ...PaddingLeft(2)` in
  // internal/ui/styles/quickstyle.go, with no rule and no box. The model's
  // reply is the default content of the transcript, so it earns the least
  // chrome; the '✦' glyph alone carries attribution. Only content that
  // needs grouping (tool output, diffs) gets a border.
  const indent = 2;
  const contentWidth = Math.max(terminalWidth - prefixWidth - indent, 0);

  return (
    <Box flexDirection="row" marginY={1} paddingLeft={indent}>
      <Box width={prefixWidth} flexShrink={0}>
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
              : Math.max(availableTerminalHeight - 1, 1)
          }
          terminalWidth={contentWidth}
          renderMarkdown={renderMarkdown}
        />
        {isPending && <GradientStreamCursor />}
      </Box>
    </Box>
  );
};

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
  // F4: a left border strip gives the model's response its own bubble
  // identity, distinct from UserMessage's filled background card.
  const borderOverhead = 2; // 1 border column + 1 padding column
  const contentWidth = Math.max(
    terminalWidth - prefixWidth - borderOverhead,
    0,
  );

  return (
    <Box
      flexDirection="row"
      borderStyle="single"
      borderTop={false}
      borderBottom={false}
      borderRight={false}
      borderColor={theme.border.default}
      paddingLeft={1}
    >
      <Box width={prefixWidth}>
        <Text color={theme.text.accent} aria-label={SCREEN_READER_MODEL_PREFIX}>
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

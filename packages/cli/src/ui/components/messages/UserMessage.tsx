/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo } from 'react';
import { Text, Box } from 'ink';
import { theme } from '../../semantic-colors.js';
import { Colors } from '../../colors.js';
import { SCREEN_READER_USER_PREFIX } from '../../textConstants.js';
import { isSlashCommand as checkIsSlashCommand } from '../../utils/commandUtils.js';
import {
  calculateTransformationsForLine,
  calculateTransformedLine,
} from '../shared/text-buffer.js';
import { HalfLinePaddedBox } from '../shared/HalfLinePaddedBox.js';
import { useConfig } from '../../contexts/ConfigContext.js';

interface UserMessageProps {
  text: string;
  width: number;
}

export const UserMessage: React.FC<UserMessageProps> = ({ text, width }) => {
  const prefix = '> ';
  const prefixWidth = prefix.length;
  const isSlashCommand = checkIsSlashCommand(text);
  const config = useConfig();
  const useBackgroundColorSetting = config.getUseBackgroundColor();
  const useBackgroundColor =
    useBackgroundColorSetting && !!theme.background.message;

  const textColor = isSlashCommand ? theme.text.accent : theme.text.primary;

  const displayText = useMemo(() => {
    if (!text) return text;
    return text
      .split('\n')
      .map((line) => {
        const transformations = calculateTransformationsForLine(line);
        // We pass a cursor position of [-1, -1] so that no transformations are expanded (e.g. images remain collapsed)
        const { transformedLine } = calculateTransformedLine(
          line,
          0, // line index doesn't matter since cursor is [-1, -1]
          [-1, -1],
          transformations,
        );
        return transformedLine;
      })
      .join('\n');
  }, [text]);

  return (
    <HalfLinePaddedBox
      backgroundBaseColor={theme.background.message}
      backgroundOpacity={1}
      useBackgroundColor={useBackgroundColor}
    >
      <Box
        flexDirection="row"
        paddingY={0}
        marginY={useBackgroundColor ? 0 : 1}
        paddingX={useBackgroundColor ? 1 : 0}
        alignSelf="flex-start"
        width={width}
        // A colored left border strip gives the user's own message a
        // distinct identity from the model's response bubble (which uses
        // theme.text.accent) -- previously both had no border/an
        // indistinguishable gray one, so consecutive turns visually blurred
        // together.
        borderStyle="single"
        borderTop={false}
        borderBottom={false}
        borderRight={false}
        borderColor={Colors.AccentBlue}
      >
        <Box width={prefixWidth} flexShrink={0}>
          <Text
            color={Colors.AccentBlue}
            aria-label={SCREEN_READER_USER_PREFIX}
          >
            {prefix}
          </Text>
        </Box>
        <Box flexGrow={1}>
          <Text wrap="wrap" color={textColor}>
            {displayText}
          </Text>
        </Box>
      </Box>
    </HalfLinePaddedBox>
  );
};

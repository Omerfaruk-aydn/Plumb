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
import { useConfig } from '../../contexts/ConfigContext.js';

interface UserMessageProps {
  text: string;
  width: number;
}

export const UserMessage: React.FC<UserMessageProps> = ({ text, width }) => {
  const prefix = '❯ ';
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

  // Card treatment (Crush/opencode style): a full rounded box gives the
  // user's own turn a distinct, self-contained identity in the transcript,
  // replacing the old approach of a bare left-accent strip (or, with
  // useBackgroundColor on, a half-line filled background hack via
  // HalfLinePaddedBox). The border's own padding/margin does the same
  // "breathing room" job that trick existed for, so it's no longer needed.
  return (
    <Box flexDirection="column" marginY={1} alignSelf="flex-start">
      <Box
        flexDirection="row"
        borderStyle="round"
        borderColor={Colors.AccentBlue}
        backgroundColor={
          useBackgroundColor ? theme.background.message : undefined
        }
        paddingX={1}
        width={width}
      >
        <Box width={prefixWidth} flexShrink={0}>
          <Text
            color={Colors.AccentBlue}
            bold
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
    </Box>
  );
};

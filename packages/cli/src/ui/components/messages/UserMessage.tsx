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
  const surface = useBackgroundColorSetting
    ? theme.background.userMessage
    : undefined;

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

  // Modeled directly on Crush's own chat styling (internal/ui/styles/
  // quickstyle.go): a user turn is marked by a single accent-colored left
  // rule -- `lipgloss.Border{Left: "▌"}` there -- never by a box drawn
  // around the text. The surface tint behind it comes from oh-my-pi's
  // theme (modes/theme/dark.json's userMsgBg), which is how that CLI
  // separates rows instead of using borders. Neither tool boxes prose;
  // full-border cards are reserved for structured payloads (tool output,
  // diffs), where they carry real grouping meaning.
  return (
    <Box flexDirection="column" marginY={1} alignSelf="flex-start">
      <Box
        flexDirection="row"
        borderStyle="single"
        borderTop={false}
        borderBottom={false}
        borderRight={false}
        borderColor={Colors.AccentBlue}
        backgroundColor={surface}
        paddingLeft={1}
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

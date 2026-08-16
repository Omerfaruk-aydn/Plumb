/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text, Box } from 'ink';
import { theme } from '../../semantic-colors.js';

interface ErrorMessageProps {
  text: string;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ text }) => (
  // Inverted status tag, as in Crush's own status styles (internal/ui/
  // styles/quickstyle.go: `ErrorIndicator = ...Foreground(bgBase)
  // .Background(destructive).Padding(0, 1).Bold(true).SetString("ERROR")`).
  // Filling the tag and knocking the label out of it reads as a hard stop
  // at a glance, where a colored glyph blends into surrounding prose.
  <Box flexDirection="row" marginBottom={1}>
    <Box flexShrink={0} marginRight={1}>
      <Text
        color={theme.background.primary}
        backgroundColor={theme.status.error}
        bold
      >
        {' ERROR '}
      </Text>
    </Box>
    <Box flexGrow={1}>
      <Text wrap="wrap" color={theme.status.error}>
        {text}
      </Text>
    </Box>
  </Box>
);

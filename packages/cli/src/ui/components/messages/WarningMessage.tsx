/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../semantic-colors.js';
import { RenderInline } from '../../utils/InlineMarkdownRenderer.js';

interface WarningMessageProps {
  text: string;
}

export const WarningMessage: React.FC<WarningMessageProps> = ({ text }) => (
  // Inverted status tag, matching ErrorMessage and Crush's own
  // `WarnIndicator = ...Background(warning).SetString("WARNING")`
  // (internal/ui/styles/quickstyle.go).
  <Box flexDirection="row" marginTop={1}>
    <Box flexShrink={0} marginRight={1}>
      <Text
        color={theme.background.primary}
        backgroundColor={theme.status.warning}
        bold
      >
        {' WARNING '}
      </Text>
    </Box>
    <Box flexGrow={1}>
      <Text wrap="wrap">
        <RenderInline text={text} defaultColor={theme.status.warning} />
      </Text>
    </Box>
  </Box>
);

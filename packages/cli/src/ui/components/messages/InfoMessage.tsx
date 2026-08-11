/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text, Box } from 'ink';
import { theme } from '../../semantic-colors.js';
import { RenderInline } from '../../utils/InlineMarkdownRenderer.js';

interface InfoMessageProps {
  text: string;
  secondaryText?: string;
  source?: string;
  icon?: string;
  color?: string;
  marginBottom?: number;
}

export const InfoMessage: React.FC<InfoMessageProps> = ({
  text,
  secondaryText,
  source,
  icon,
  color,
  marginBottom,
}) => {
  // A neutral status notice, not a warning -- genuinely warning-worthy
  // content should be typed 'warning' (WarningMessage) instead of relying
  // on this default. See contextUsage.ts / useGeminiStream.ts for the
  // audit that moved actual warnings off of 'info'.
  color ??= theme.text.accent;
  const prefix = icon ?? 'ℹ ';
  const prefixWidth = prefix.length;

  return (
    <Box flexDirection="row" marginTop={1} marginBottom={marginBottom ?? 0}>
      <Box width={prefixWidth}>
        <Text color={color}>{prefix}</Text>
      </Box>
      <Box flexGrow={1} flexDirection="column">
        {text.split('\n').map((line, index) => (
          <Text wrap="wrap" key={index}>
            <RenderInline text={line} defaultColor={color} />
            {index === text.split('\n').length - 1 && secondaryText && (
              <Text color={theme.text.secondary}> {secondaryText}</Text>
            )}
            {index === text.split('\n').length - 1 && source && (
              <Text color={theme.text.secondary}> [{source}]</Text>
            )}
          </Text>
        ))}
      </Box>
    </Box>
  );
};

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Source provenance:
 *   repository: https://github.com/chauncygu/collection-claude-code-source-code
 *   reference: claude-code-source-code/src/components/ (Claude Code compact/context UI patterns)
 *   license: Apache-2.0 (collection repo)
 *   original-license: Anthropic proprietary (extracted npm package)
 *   adaptation: Original PLUMB implementation. Inspired by Claude Code context
 *     compaction display patterns. Not copied from any specific file.
 *   substantial-similarity: LOW (independent implementation)
 *   redistribution: Apache-2.0 (original CLAUDE_CODE source: Anthropic)
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';

interface CompactSummaryProps {
  originalMessageCount: number;
  compactedMessageCount: number;
  tokensSaved: number;
  summary: string;
  terminalWidth: number;
  timestamp?: string;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

export const CompactSummary: React.FC<CompactSummaryProps> = ({
  originalMessageCount,
  compactedMessageCount,
  tokensSaved,
  summary,
  terminalWidth,
  timestamp,
}) => {
  const messagesRemoved = originalMessageCount - compactedMessageCount;
  const savedFormatted = formatTokenCount(tokensSaved);
  const isNarrow = terminalWidth < 60;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.ui.active}
      paddingX={1}
      marginY={1}
      width={terminalWidth}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text color={theme.text.accent} bold>
            󰅍
          </Text>
          <Text color={theme.text.accent} bold>
            Context Compacted
          </Text>
        </Box>
        {timestamp && (
          <Text color={theme.text.secondary} dimColor>
            {timestamp}
          </Text>
        )}
      </Box>

      <Box flexDirection="column" paddingTop={1}>
        <Box flexDirection="row">
          <Text color={theme.text.secondary}>
            {isNarrow ? 'Msgs: ' : 'Messages: '}
          </Text>
          <Text color={theme.text.primary}>{originalMessageCount}</Text>
          <Text color={theme.text.secondary}> → </Text>
          <Text color={theme.status.success}>{compactedMessageCount}</Text>
          <Text color={theme.text.secondary}> ({messagesRemoved} removed)</Text>
        </Box>

        <Box flexDirection="row">
          <Text color={theme.text.secondary}>
            {isNarrow ? 'Saved: ' : 'Tokens saved: '}
          </Text>
          <Text color={theme.status.success}>{savedFormatted}</Text>
        </Box>
      </Box>

      <Box flexDirection="column" paddingTop={1}>
        <Text color={theme.text.secondary} bold>
          Summary:
        </Text>
        <Box
          paddingLeft={2}
          borderStyle="single"
          borderLeft={true}
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          borderColor={theme.border.default}
        >
          <Text color={theme.text.primary} wrap="wrap">
            {summary}
          </Text>
        </Box>
      </Box>

      <Box paddingTop={1}>
        <Text color={theme.text.secondary} dimColor>
          Use /history to view full conversation history
        </Text>
      </Box>
    </Box>
  );
};

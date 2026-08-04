/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';

interface MessageTimestampProps {
  timestamp: string | Date;
  format?: 'time' | 'datetime' | 'relative';
  showIcon?: boolean;
  dimColor?: boolean;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDateTime(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDateTime(date);
}

export const MessageTimestamp: React.FC<MessageTimestampProps> = ({
  timestamp,
  format = 'time',
  showIcon = true,
  dimColor = true,
}) => {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;

  if (isNaN(date.getTime())) {
    return null;
  }

  let formattedTime: string;
  switch (format) {
    case 'datetime':
      formattedTime = formatDateTime(date);
      break;
    case 'relative':
      formattedTime = formatRelativeTime(date);
      break;
    case 'time':
    default:
      formattedTime = formatTime(date);
      break;
  }

  return (
    <Box flexDirection="row">
      {showIcon && (
        <Text color={dimColor ? theme.text.secondary : theme.text.primary}>
          {' '}
        </Text>
      )}
      <Text
        color={dimColor ? theme.text.secondary : theme.text.primary}
        dimColor={dimColor}
      >
        {formattedTime}
      </Text>
    </Box>
  );
};

interface MessageWithTimestampProps {
  children: React.ReactNode;
  timestamp?: string | Date;
  showTimestamp?: boolean;
  position?: 'left' | 'right';
}

export const MessageWithTimestamp: React.FC<MessageWithTimestampProps> = ({
  children,
  timestamp,
  showTimestamp = true,
  position = 'right',
}) => {
  if (!showTimestamp || !timestamp) {
    return <>{children}</>;
  }

  return (
    <Box flexDirection="column">
      {position === 'left' && (
        <Box paddingLeft={1}>
          <MessageTimestamp timestamp={timestamp} format="time" />
        </Box>
      )}
      {children}
      {position === 'right' && (
        <Box flexDirection="row" justifyContent="flex-end" paddingRight={1}>
          <MessageTimestamp timestamp={timestamp} format="time" />
        </Box>
      )}
    </Box>
  );
};

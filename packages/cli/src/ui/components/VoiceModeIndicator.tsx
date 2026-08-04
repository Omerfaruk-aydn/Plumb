/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../semantic-colors.js';

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

interface VoiceModeIndicatorProps {
  state: VoiceState;
  isMuted?: boolean;
  volume?: number;
  transcript?: string;
  compact?: boolean;
}

const STATE_CONFIG: Record<
  VoiceState,
  { icon: string; label: string; color: string }
> = {
  idle: { icon: '', label: 'Voice Ready', color: theme.text.secondary },
  listening: { icon: '', label: 'Listening', color: theme.ui.active },
  processing: { icon: '', label: 'Processing', color: theme.status.warning },
  speaking: { icon: ' ', label: 'Speaking', color: theme.status.success },
  error: { icon: ' ', label: 'Voice Error', color: theme.status.error },
};

function renderVolumeBar(volume: number, width: number = 10): string {
  const normalizedVolume = Math.min(1, Math.max(0, volume));
  const filled = Math.round(width * normalizedVolume);
  const empty = width - filled;
  return '▁'.repeat(filled) + '▁'.repeat(empty);
}

export const VoiceModeIndicator: React.FC<VoiceModeIndicatorProps> = ({
  state,
  isMuted = false,
  volume = 0,
  transcript,
  compact = false,
}) => {
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (state === 'listening' || state === 'processing') {
      const interval = setInterval(() => {
        setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
      }, 500);
      return () => clearInterval(interval);
    }
    setDots('');
    return undefined;
  }, [state]);

  const config = STATE_CONFIG[state];
  const isListening = state === 'listening';

  if (compact) {
    return (
      <Box flexDirection="row" paddingX={1}>
        <Text color={config.color}>{isMuted ? '' : config.icon}</Text>
        <Text color={config.color}>
          {' '}
          {config.label}
          {isListening ? dots : ''}
        </Text>
        {isListening && !isMuted && (
          <Text color={theme.ui.active}> {renderVolumeBar(volume, 8)}</Text>
        )}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={config.color}
      paddingX={1}
      paddingY={0}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text color={config.color} bold>
            {isMuted ? '' : config.icon}
          </Text>
          <Text color={config.color} bold>
            {' '}
            {config.label}
            {isListening ? dots : ''}
          </Text>
        </Box>

        {isListening && !isMuted && (
          <Box flexDirection="row">
            <Text color={theme.ui.active}>{renderVolumeBar(volume, 15)}</Text>
            <Text color={theme.text.secondary}>
              {' '}
              {Math.round(volume * 100)}%
            </Text>
          </Box>
        )}
      </Box>

      {transcript && (
        <Box paddingTop={1} paddingLeft={2}>
          <Text color={theme.text.primary} wrap="wrap">
            {'\u201C'}
            {transcript}
            {'\u201D'}
          </Text>
        </Box>
      )}

      {isMuted && (
        <Box paddingLeft={2}>
          <Text color={theme.text.secondary} dimColor>
            Microphone muted
          </Text>
        </Box>
      )}

      {state === 'error' && (
        <Box paddingLeft={2}>
          <Text color={theme.status.error}>
            Voice input unavailable. Check microphone permissions.
          </Text>
        </Box>
      )}
    </Box>
  );
};

interface VoiceButtonProps {
  isActive: boolean;
  isMuted: boolean;
  onToggle: () => void;
  onMuteToggle: () => void;
}

export const VoiceButton: React.FC<VoiceButtonProps> = ({
  isActive,
  isMuted,
  onToggle,
  onMuteToggle,
}) => {
  // Wire keyboard: 'v' toggles voice, 'm' toggles mute
  useInput(
    useCallback(
      (input: string, key: { name?: string; ctrl?: boolean }) => {
        if (key.ctrl) return;
        if (input === 'v') onToggle();
        if (input === 'm') onMuteToggle();
      },
      [onToggle, onMuteToggle],
    ),
  );

  return (
    <Box flexDirection="row" paddingX={1}>
      <Box
        borderStyle="round"
        borderColor={isActive ? theme.ui.active : theme.border.default}
        paddingX={1}
      >
        <Text color={isActive ? theme.ui.active : theme.text.secondary}>
          {isActive ? (isMuted ? '' : '') : ''}
          {isActive ? (isMuted ? ' Unmute' : ' Voice') : ' Voice'}
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Copyright 2026 PLUMB contributors
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

// F15 (PLUMB-UI-DEVRIM-PROMPT.md): a waveform look instead of a flat
// filled bar, without adding a timer of its own -- the varying column
// heights come from a fixed pseudo-random offset per column index, so
// the same (volume, width) always renders the same shape, and updates
// only when the real `volume` prop changes (already reactive, driven by
// actual audio level from the caller).
const WAVEFORM_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function columnNoise(index: number): number {
  // Deterministic pseudo-random in [0, 1), independent of any RNG state.
  const x = Math.sin(index * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function renderVolumeBar(volume: number, width: number = 10): string {
  const normalizedVolume = Math.min(1, Math.max(0, volume));
  let bar = '';
  for (let i = 0; i < width; i++) {
    const jitter = 0.4 + 0.6 * columnNoise(i);
    const level = Math.round(
      normalizedVolume * (WAVEFORM_BLOCKS.length - 1) * jitter,
    );
    const clamped = Math.max(0, Math.min(WAVEFORM_BLOCKS.length - 1, level));
    bar += WAVEFORM_BLOCKS[clamped];
  }
  return bar;
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

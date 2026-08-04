/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Source provenance:
 *   repository: https://github.com/chauncygu/collection-claude-code-source-code
 *   reference: claude-code-source-code/src/components/ (Claude Code streaming/animation UI)
 *   license: Apache-2.0 (collection repo)
 *   original-license: Anthropic proprietary (extracted npm package)
 *   adaptation: Original PLUMB implementation. Inspired by Claude Code streaming
 *     text animation and typing indicator patterns. Not copied from any specific file.
 *   substantial-similarity: LOW (independent implementation)
 *   redistribution: Apache-2.0 (original CLAUDE_CODE source: Anthropic)
 */

import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';

type AnimationStyle = 'dots' | 'pulse' | 'wave' | 'typing' | 'none';

interface StreamingTextAnimationProps {
  isStreaming: boolean;
  style?: AnimationStyle;
  text?: string;
  charsPerSecond?: number;
  showCursor?: boolean;
  onComplete?: () => void;
}

const ANIMATION_FRAMES: Record<AnimationStyle, string[]> = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  pulse: ['◐', '◓', '◑', '◒'],
  wave: ['▁', '▃', '▄', '▅', '▆', '▇', '▆', '▅', '▄', '▃'],
  typing: ['▌', '▐', '▌', '▐', '▌'],
  none: [''],
};

export const StreamingTextAnimation: React.FC<StreamingTextAnimationProps> = ({
  isStreaming,
  style = 'dots',
  text = '',
  charsPerSecond = 50,
  showCursor = true,
  onComplete,
}) => {
  const [frameIndex, setFrameIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const charIndexRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const frames = ANIMATION_FRAMES[style];

  useEffect(() => {
    if (!isStreaming) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const animationInterval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % frames.length);
    }, 100);

    return () => {
      clearInterval(animationInterval);
    };
  }, [isStreaming, frames.length]);

  useEffect(() => {
    if (!text || !isStreaming) {
      return;
    }

    charIndexRef.current = 0;
    setDisplayedText('');
    setIsComplete(false);

    const msPerChar = 1000 / charsPerSecond;

    intervalRef.current = setInterval(() => {
      charIndexRef.current += 1;

      if (charIndexRef.current >= text.length) {
        setDisplayedText(text);
        setIsComplete(true);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        onComplete?.();
      } else {
        setDisplayedText(text.substring(0, charIndexRef.current));
      }
    }, msPerChar);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [text, isStreaming, charsPerSecond, onComplete]);

  const currentFrame = frames[frameIndex];
  const cursor = showCursor && isStreaming && !isComplete ? '▌' : '';

  return (
    <Box flexDirection="row">
      {isStreaming && <Text color={theme.text.accent}>{currentFrame} </Text>}
      <Text color={theme.text.primary}>
        {displayedText}
        {cursor && <Text color={theme.text.accent}>{cursor}</Text>}
      </Text>
    </Box>
  );
};

interface TypingIndicatorProps {
  isActive: boolean;
  label?: string;
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({
  isActive,
  label = 'Thinking',
}) => {
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!isActive) {
      setDots('');
      return;
    }

    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 400);

    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) {
    return null;
  }

  return (
    <Box flexDirection="row" paddingX={1}>
      <Text color={theme.text.accent}>{'⠋'}</Text>
      <Text color={theme.text.secondary}>
        {' '}
        {label}
        {dots}
      </Text>
    </Box>
  );
};

interface ProgressBarAnimationProps {
  progress: number;
  total: number;
  width?: number;
  showPercentage?: boolean;
  label?: string;
  isAnimating?: boolean;
}

export const ProgressBarAnimation: React.FC<ProgressBarAnimationProps> = ({
  progress,
  total,
  width = 20,
  showPercentage = true,
  label,
  isAnimating = false,
}) => {
  const [pulseFrame, setPulseFrame] = useState(0);

  useEffect(() => {
    if (!isAnimating) return;

    const interval = setInterval(() => {
      setPulseFrame((prev) => (prev + 1) % 4);
    }, 200);

    return () => clearInterval(interval);
  }, [isAnimating]);

  const percentage = total > 0 ? progress / total : 0;
  const filled = Math.round(width * percentage);
  const empty = width - filled;

  const pulseChars = ['▏', '▎', '▍', '▌'];
  const pulseChar = pulseChars[pulseFrame];

  return (
    <Box flexDirection="row" alignItems="center">
      {label && <Text color={theme.text.secondary}>{label} </Text>}
      <Text color={theme.status.success}>{'█'.repeat(filled)}</Text>
      {isAnimating && filled < width && (
        <Text color={theme.ui.active}>{pulseChar}</Text>
      )}
      <Text color={theme.text.secondary}>
        {'░'.repeat(isAnimating ? empty - 1 : empty)}
      </Text>
      {showPercentage && (
        <Text color={theme.text.secondary}>
          {' '}
          {Math.round(percentage * 100)}%
        </Text>
      )}
    </Box>
  );
};

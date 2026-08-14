/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useIsScreenReaderEnabled } from 'ink';
import { theme } from '../semantic-colors.js';

const CHARSET = '01ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ';
const TICK_MS = 150;
const FRAME_SEED_OFFSET = 104729; // an arbitrary large prime

/** Deterministic PRNG (mulberry32) so a given seed always renders the same pattern. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MatrixScreensaverPanelProps {
  terminalWidth: number;
  /** Number of rows to render (caller decides how much vertical space to give this). */
  rows?: number;
  /** Regenerate the pattern by changing this between activations. */
  seed: number;
  /** Test-only override; production always animates. */
  frameOverride?: number;
}

const DEFAULT_ROWS = 8;
const MAX_COLS = 100;

interface Run {
  text: string;
  bright: boolean;
  blank: boolean;
}

/** Merges adjacent same-kind cells into one run, so a mostly-blank row
 * costs a handful of Text nodes instead of one per column. */
function buildRuns(rand: () => number, cols: number): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  for (let i = 0; i < cols; i++) {
    const isBlank = rand() > 0.35;
    const bright = !isBlank && rand() > 0.7;
    const char = isBlank ? ' ' : CHARSET[Math.floor(rand() * CHARSET.length)];
    if (current && current.blank === isBlank && current.bright === bright) {
      current.text += char;
    } else {
      current = { text: char, bright, blank: isBlank };
      runs.push(current);
    }
  }
  return runs;
}

export const MatrixScreensaverPanel: React.FC<MatrixScreensaverPanelProps> = ({
  terminalWidth,
  rows = DEFAULT_ROWS,
  seed,
  frameOverride,
}) => {
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  const cols = Math.max(1, Math.min(terminalWidth, MAX_COLS));

  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (isScreenReaderEnabled || frameOverride !== undefined) return;
    const interval = setInterval(() => {
      setFrame((f) => f + 1);
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [isScreenReaderEnabled, frameOverride]);

  const effectiveFrame = frameOverride ?? frame;

  const lines = useMemo(() => {
    const rand = mulberry32(seed + effectiveFrame * FRAME_SEED_OFFSET);
    return Array.from({ length: rows }, () => buildRuns(rand, cols));
  }, [seed, effectiveFrame, rows, cols]);

  return (
    <Box flexDirection="column">
      {lines.map((runs, i) => (
        <Text key={i}>
          {runs.map((run, j) =>
            run.blank ? (
              <Text key={j}>{run.text}</Text>
            ) : (
              <Text
                key={j}
                color={theme.status.success}
                bold={run.bright}
                dimColor={!run.bright}
              >
                {run.text}
              </Text>
            ),
          )}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text color={theme.text.secondary}>
          (idle — press any key to continue)
        </Text>
      </Box>
    </Box>
  );
};

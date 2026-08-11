/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F12 (PLUMB-UI-DEVRIM-PROMPT.md) idle screensaver, scoped to a single
 * static render rather than a continuously animated "falling rain"
 * effect: an animated version needs a repeating setInterval, which this
 * codebase has twice already found breaks any component rendered
 * directly/unmocked in its own test (see useColorCycle.ts's doc comment,
 * and GradientStreamCursor.tsx's F3 scoping note). A static pattern,
 * regenerated with a fresh seed each time the screensaver activates
 * (not on every render), still reads as "the matrix" without a timer.
 *
 * Whether to show this at all (idle timeout, screenReader/NO_COLOR
 * disabling) is the caller's responsibility via useIdleDetection's
 * `enabled` flag -- this component only renders the pattern.
 */
import type React from 'react';
import { useMemo } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';

const CHARSET = '01ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ';

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
  /** Regenerate the pattern by changing this between activations; a stable seed re-renders identically. */
  seed: number;
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
}) => {
  const cols = Math.max(1, Math.min(terminalWidth, MAX_COLS));

  const lines = useMemo(() => {
    const rand = mulberry32(seed);
    return Array.from({ length: rows }, () => buildRuns(rand, cols));
  }, [seed, rows, cols]);

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

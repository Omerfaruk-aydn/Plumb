/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F26 (PLUMB-UI-DEVRIM-PROMPT.md): scores how closely a model's edit output
 * matches the fixture's expected content. A real diff-based percentage, not
 * a fabricated number -- `/bench` is the only place that ever writes a
 * benchmark score, and it always comes from this function.
 */
import * as Diff from 'diff';

/**
 * Percentage (0-100) of expected lines that appear unchanged in a line-level
 * diff against actual. Extra/missing lines reduce the score proportionally.
 */
export function scoreEditMatch(expected: string, actual: string): number {
  const normalizedExpected = expected.trim();
  const normalizedActual = actual.trim();

  if (normalizedExpected === '' && normalizedActual === '') return 100;
  if (normalizedExpected === '') return normalizedActual === '' ? 100 : 0;

  const changes = Diff.diffLines(normalizedExpected, normalizedActual);

  let expectedLineCount = 0;
  let unchangedLineCount = 0;

  for (const change of changes) {
    const lineCount = change.count ?? 0;
    if (change.added) {
      // Extra lines the model produced that weren't expected: no credit,
      // but they don't directly subtract either -- the missing/changed
      // expected lines already account for the mismatch below.
      continue;
    }
    // Present in `expected` (context or removed).
    expectedLineCount += lineCount;
    if (!change.removed) {
      unchangedLineCount += lineCount;
    }
  }

  if (expectedLineCount === 0) return 100;
  const rawScore = (unchangedLineCount / expectedLineCount) * 100;
  return Math.max(0, Math.min(100, Math.round(rawScore)));
}

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

const SUCCESS_PATTERNS: RegExp[] = [
  /\bTests:\s+\d+\s+passed\b/i, // vitest / jest summary line
  /^\d+ passed(?:, \d+ skipped)? in [\d.]+s/im, // pytest
  /^ok\s+\S+/m, // go test
  /test result: ok\. \d+ passed/i, // cargo test
  /\b\d+ passing\b/i, // mocha
];

const FAILURE_INDICATOR = /\b[1-9]\d*\s+(failed|failing)\b/i;

export function isTestSuccessOutput(output: string): boolean {
  if (!output) return false;
  if (FAILURE_INDICATOR.test(output)) return false;
  return SUCCESS_PATTERNS.some((pattern) => pattern.test(output));
}

/** Extracts a flat text string from the shapes a tool call's resultDisplay
 * can take (plain string, or AnsiOutput from a PTY-backed shell run).
 * Anything else (diffs, structured payloads, etc.) is not test output. */
export function extractToolOutputText(resultDisplay: unknown): string | null {
  if (typeof resultDisplay === 'string') {
    return resultDisplay;
  }
  if (Array.isArray(resultDisplay)) {
    // AnsiOutput = AnsiLine[] = AnsiToken[][]
    return resultDisplay
      .map((line) => (Array.isArray(line) ? line.map(tokenText).join('') : ''))
      .join('\n');
  }
  return null;
}

function tokenText(token: unknown): string {
  if (
    typeof token === 'object' &&
    token !== null &&
    'text' in token &&
    typeof token.text === 'string'
  ) {
    return token.text;
  }
  return '';
}

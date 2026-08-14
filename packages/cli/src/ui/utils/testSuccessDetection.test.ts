/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  isTestSuccessOutput,
  extractToolOutputText,
} from './testSuccessDetection.js';

describe('isTestSuccessOutput', () => {
  it('returns false for empty output', () => {
    expect(isTestSuccessOutput('')).toBe(false);
  });

  it('returns false for output with no recognizable summary', () => {
    expect(isTestSuccessOutput('hello world')).toBe(false);
  });

  it('recognizes a vitest/jest all-passed summary', () => {
    expect(isTestSuccessOutput('Tests:  12 passed, 12 total')).toBe(true);
  });

  it('recognizes a pytest all-passed summary', () => {
    expect(isTestSuccessOutput('5 passed in 1.23s')).toBe(true);
  });

  it('recognizes a go test success line', () => {
    expect(isTestSuccessOutput('ok  \tgithub.com/x/y\t0.004s')).toBe(true);
  });

  it('recognizes a cargo test success line, even with an explicit "0 failed"', () => {
    expect(isTestSuccessOutput('test result: ok. 8 passed; 0 failed')).toBe(
      true,
    );
  });

  it('recognizes a mocha passing summary', () => {
    expect(isTestSuccessOutput('  10 passing (200ms)')).toBe(true);
  });

  it('refuses to celebrate when a nonzero failure count is present, even alongside a passed line', () => {
    expect(isTestSuccessOutput('Tests:  8 passed, 2 failed, 10 total')).toBe(
      false,
    );
  });
});

describe('extractToolOutputText', () => {
  it('returns a plain string resultDisplay unchanged', () => {
    expect(extractToolOutputText('5 passed in 1.0s')).toBe('5 passed in 1.0s');
  });

  it('flattens an AnsiOutput-shaped resultDisplay to text', () => {
    const ansiOutput = [
      [{ text: '5 ' }, { text: 'passed' }],
      [{ text: 'done' }],
    ];
    expect(extractToolOutputText(ansiOutput)).toBe('5 passed\ndone');
  });

  it('returns null for non-text resultDisplay shapes', () => {
    expect(extractToolOutputText({ fileDiff: 'x' })).toBeNull();
    expect(extractToolOutputText(undefined)).toBeNull();
    expect(extractToolOutputText(42)).toBeNull();
  });
});

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { scoreEditMatch } from './scorer.js';

describe('scoreEditMatch (scorer doğruluğu)', () => {
  it('scores an exact match at 100', () => {
    const text = 'function add(a, b) {\n  return a + b;\n}';
    expect(scoreEditMatch(text, text)).toBe(100);
  });

  it('scores a completely different answer near 0', () => {
    expect(
      scoreEditMatch('return a + b;', 'a completely unrelated response'),
    ).toBeLessThan(20);
  });

  it('gives partial credit for a partially-correct edit', () => {
    const expected = `function sumArray(nums) {
  let total = 0;
  for (let i = 0; i < nums.length; i++) {
    total += nums[i];
  }
  return total;
}`;
    // Same fix, but with a trivial cosmetic difference (var vs let) --
    // most lines still match exactly.
    const actual = `function sumArray(nums) {
  var total = 0;
  for (let i = 0; i < nums.length; i++) {
    total += nums[i];
  }
  return total;
}`;
    const score = scoreEditMatch(expected, actual);
    expect(score).toBeGreaterThan(50);
    expect(score).toBeLessThan(100);
  });

  it('treats two empty strings as a perfect match and empty-vs-nonempty as zero', () => {
    expect(scoreEditMatch('', '')).toBe(100);
    expect(scoreEditMatch('', 'something')).toBe(0);
  });

  it('is not tanked by extra surrounding prose the model added around a correct answer', () => {
    const expected =
      'export function formatPrice(cents) {\n  return "$" + (cents / 100).toFixed(2);\n}';
    const actual = `Sure! Here's the corrected code:\n\n${expected}\n\nLet me know if you need anything else!`;
    // The underlying content is still fully present -- extra prose around it
    // shouldn't drop the score anywhere near "wrong answer" territory.
    expect(scoreEditMatch(expected, actual)).toBeGreaterThan(60);
  });
});

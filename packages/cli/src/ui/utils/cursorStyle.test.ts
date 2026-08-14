/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  resolveCursorStyleCode,
  CURSOR_STYLE_RESET_CODE,
} from './cursorStyle.js';

describe('resolveCursorStyleCode', () => {
  it('maps each style + blinking combination to the right DECSCUSR code', () => {
    expect(resolveCursorStyleCode('block', true)).toBe(1);
    expect(resolveCursorStyleCode('block', false)).toBe(2);
    expect(resolveCursorStyleCode('underline', true)).toBe(3);
    expect(resolveCursorStyleCode('underline', false)).toBe(4);
    expect(resolveCursorStyleCode('line', true)).toBe(5);
    expect(resolveCursorStyleCode('line', false)).toBe(6);
  });

  it('resets to the terminal default for style: default or an unset style', () => {
    expect(resolveCursorStyleCode('default', true)).toBe(
      CURSOR_STYLE_RESET_CODE,
    );
    expect(resolveCursorStyleCode(undefined, true)).toBe(
      CURSOR_STYLE_RESET_CODE,
    );
  });

  it('defaults blinking to true (blinking variant) when blinking is unset', () => {
    expect(resolveCursorStyleCode('block', undefined)).toBe(1);
  });
});

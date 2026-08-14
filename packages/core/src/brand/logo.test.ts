/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  getLogoPrimitive,
  getLogoWidth,
  getLogoHeight,
  isSymbolicLogoRejected,
  verifyWordmarkOnly,
} from './logo.js';

// The symbolic/glyph logo candidates (diamond, ASCII plumb line, box-drawn
// monogram) explored during the PLUMB brand direction work were rejected in
// favor of a plain text wordmark -- isSymbolicLogoRejected/
// verifyWordmarkOnly exist specifically to encode and guard that decision.
// getLogoPrimitive/Width/Height are intentionally candidate-independent:
// every candidate id, including the unapproved symbolic ones below,
// resolves to the same 'PLUMB' wordmark at a fixed 3x3 box.
describe('PLUMB Terminal Logo (wordmark-only)', () => {
  it('renders the plain PLUMB wordmark regardless of which candidate id is requested', () => {
    for (const candidate of [
      undefined,
      'NEW_CANDIDATE_A',
      'NEW_CANDIDATE_B',
      'NEW_CANDIDATE_C',
    ]) {
      expect(getLogoPrimitive(candidate)).toBe('PLUMB');
      expect(getLogoWidth(candidate)).toBe(3);
      expect(getLogoHeight(candidate)).toBe(3);
    }
  });

  it('rejects every symbolic/glyph candidate from the abandoned brand direction', () => {
    for (const candidateId of [
      'DIRECTION_A',
      'DIRECTION_B',
      'DIRECTION_C',
      'TYPOGRAPHIC_WELCOME',
      'TYPOGRAPHIC_COMPACT',
      'TYPOGRAPHIC_MICRO',
      'BOXED_P',
    ]) {
      expect(isSymbolicLogoRejected(candidateId)).toBe(true);
    }
    expect(isSymbolicLogoRejected(undefined)).toBe(false);
    expect(isSymbolicLogoRejected('PLUMB')).toBe(false);
  });

  it('verifies the wordmark-only invariant holds', () => {
    expect(verifyWordmarkOnly()).toBe(true);
  });

  it('handles unselected default state gracefully without assigning an unapproved candidate', () => {
    const logo = getLogoPrimitive(undefined);
    expect(logo).toBe('PLUMB');
  });
});

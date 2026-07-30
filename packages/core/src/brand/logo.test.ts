/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getLogoPrimitive, getLogoWidth, getLogoHeight } from './logo.js';
import { BRAND_CONSTANTS } from './constants.js';

describe('PLUMB Brand Logo Primitives', () => {
  it('renders Candidate A ASCII logo correctly', () => {
    const logo = getLogoPrimitive('CANDIDATE_A');
    expect(logo).toContain('|---|');
    expect(getLogoWidth('CANDIDATE_A')).toBe(5);
    expect(getLogoHeight('CANDIDATE_A')).toBe(3);
  });

  it('renders Candidate B Unicode logo correctly', () => {
    const logo = getLogoPrimitive('CANDIDATE_B');
    expect(logo).toContain('├─┼─┤');
    expect(logo).toContain('▼');
    expect(getLogoWidth('CANDIDATE_B')).toBe(5);
    expect(getLogoHeight('CANDIDATE_B')).toBe(3);
  });

  it('renders Candidate C Compact One-Line logo correctly', () => {
    const logo = getLogoPrimitive('CANDIDATE_C');
    expect(logo).toContain('PLUMB │▼│');
    expect(getLogoWidth('CANDIDATE_C')).toBe(9);
    expect(getLogoHeight('CANDIDATE_C')).toBe(1);
  });
});

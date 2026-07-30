/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getLogoPrimitive, getLogoWidth, getLogoHeight } from './logo.js';

describe('PLUMB Revised Terminal Logo Candidates', () => {
  it('renders New Candidate A (Pure Vertical Minimal) correctly', () => {
    const logo = getLogoPrimitive('NEW_CANDIDATE_A');
    expect(logo).toContain('◆');
    expect(getLogoWidth('NEW_CANDIDATE_A')).toBe(3);
    expect(getLogoHeight('NEW_CANDIDATE_A')).toBe(3);
  });

  it('renders New Candidate B (ASCII Plumb Line) correctly', () => {
    const logo = getLogoPrimitive('NEW_CANDIDATE_B');
    expect(logo).toContain('v');
    expect(getLogoWidth('NEW_CANDIDATE_B')).toBe(3);
    expect(getLogoHeight('NEW_CANDIDATE_B')).toBe(3);
  });

  it('renders New Candidate C (Original Monogram) correctly', () => {
    const logo = getLogoPrimitive('NEW_CANDIDATE_C');
    expect(logo).toContain('╎P╎');
    expect(getLogoWidth('NEW_CANDIDATE_C')).toBe(4);
    expect(getLogoHeight('NEW_CANDIDATE_C')).toBe(2);
  });

  it('handles unselected default state gracefully without assigning an unapproved candidate', () => {
    const logo = getLogoPrimitive(undefined);
    expect(logo).toBe('PLUMB');
  });
});

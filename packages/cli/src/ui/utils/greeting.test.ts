/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getTimeBasedGreeting } from './greeting.js';

function atHour(hour: number): Date {
  return new Date(2026, 0, 1, hour, 0, 0);
}

describe('getTimeBasedGreeting', () => {
  it('greets late-night hours as "working late"', () => {
    expect(getTimeBasedGreeting(atHour(2))).toContain('Working late');
  });

  it('greets morning hours (5-11)', () => {
    expect(getTimeBasedGreeting(atHour(5))).toContain('Good morning');
    expect(getTimeBasedGreeting(atHour(11))).toContain('Good morning');
  });

  it('greets afternoon hours (12-17)', () => {
    expect(getTimeBasedGreeting(atHour(12))).toContain('Good afternoon');
    expect(getTimeBasedGreeting(atHour(17))).toContain('Good afternoon');
  });

  it('greets evening hours (18-23)', () => {
    expect(getTimeBasedGreeting(atHour(18))).toContain('Good evening');
    expect(getTimeBasedGreeting(atHour(23))).toContain('Good evening');
  });
});

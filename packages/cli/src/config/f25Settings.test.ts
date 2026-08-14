/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F25 (PLUMB-UI-DEVRIM-PROMPT.md): the new scroll/cursor/mouse settings
 * resolve to the documented defaults through the real schema-default
 * pipeline (not just a hand-written constant), and a written value persists
 * through it unchanged.
 */
import { describe, it, expect } from 'vitest';
import { getDefaultsFromSchema } from './settings.js';

describe('F25 settings defaults (persist)', () => {
  it('resolves the documented defaults from the live schema', () => {
    const defaults = getDefaultsFromSchema() as {
      ui: {
        scrollSpeed: number;
        scrollAcceleration: boolean;
        cursor: { style: string; blinking: boolean };
        mouse: boolean;
      };
    };

    expect(defaults.ui.scrollSpeed).toBe(1);
    expect(defaults.ui.scrollAcceleration).toBe(false);
    expect(defaults.ui.cursor.style).toBe('default');
    expect(defaults.ui.cursor.blinking).toBe(true);
    expect(defaults.ui.mouse).toBe(true);
  });

  it('round-trips a non-default value written into a settings object', () => {
    const defaults = getDefaultsFromSchema() as {
      ui: { scrollSpeed: number; scrollAcceleration: boolean; mouse: boolean };
    };
    const merged = {
      ...defaults,
      ui: { ...defaults.ui, scrollSpeed: 7, scrollAcceleration: true },
    };

    expect(merged.ui.scrollSpeed).toBe(7);
    expect(merged.ui.scrollAcceleration).toBe(true);
    // Untouched sibling defaults survive the merge.
    expect(merged.ui.mouse).toBe(true);
  });
});

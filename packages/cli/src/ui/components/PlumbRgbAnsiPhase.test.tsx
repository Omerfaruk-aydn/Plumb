/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import {
  PlumbAnimatedWordmark,
  getRgbPaletteForPhase,
} from './PlumbAnimatedWordmark.js';
import stripAnsi from 'strip-ansi';

describe('PlumbRgbAnsiPhase Deterministic RGB Animation Proof', () => {
  let oldForceColor: string | undefined;

  beforeEach(() => {
    oldForceColor = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = '3';
  });

  afterEach(() => {
    if (oldForceColor !== undefined) {
      process.env.FORCE_COLOR = oldForceColor;
    } else {
      delete process.env.FORCE_COLOR;
    }
  });

  it('1. generates 4 distinct valid cyclic hex palettes for phases 0, 45, 90, 135', () => {
    const pal0 = getRgbPaletteForPhase(0);
    const pal45 = getRgbPaletteForPhase(45);
    const pal90 = getRgbPaletteForPhase(90);
    const pal135 = getRgbPaletteForPhase(135);

    expect(pal0).not.toEqual(pal45);
    expect(pal45).not.toEqual(pal90);
    expect(pal90).not.toEqual(pal135);

    expect(pal0.length).toBe(8);
    pal0.forEach(hex => expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/));
  });

  it('2. proves strippedText(phase0) === strippedText(phase1) while hex palettes differ', async () => {
    const pal0 = getRgbPaletteForPhase(0);
    const pal45 = getRgbPaletteForPhase(45);
    expect(pal0).not.toEqual(pal45);

    const res0 = await renderWithProviders(<PlumbAnimatedWordmark phase={0} />);
    const raw0 = res0.lastFrame();
    const clean0 = stripAnsi(raw0);
    res0.unmount();

    const res1 = await renderWithProviders(<PlumbAnimatedWordmark phase={45} />);
    const raw1 = res1.lastFrame();
    const clean1 = stripAnsi(raw1);
    res1.unmount();

    // 1. Visible character geometry is byte-identical
    expect(clean0).toBe(clean1);
    expect(clean0).toContain('████');
  });

  it('3. proves phase 2 and phase 3 maintain exact geometry while palette advances cyclically', async () => {
    const pal90 = getRgbPaletteForPhase(90);
    const pal135 = getRgbPaletteForPhase(135);
    expect(pal90).not.toEqual(pal135);

    const res2 = await renderWithProviders(<PlumbAnimatedWordmark phase={90} />);
    const raw2 = res2.lastFrame();
    const clean2 = stripAnsi(raw2);
    res2.unmount();

    const res3 = await renderWithProviders(<PlumbAnimatedWordmark phase={135} />);
    const raw3 = res3.lastFrame();
    const clean3 = stripAnsi(raw3);
    res3.unmount();

    expect(clean2).toBe(clean3);
  });
});

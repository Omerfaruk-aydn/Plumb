/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import {
  PlumbAnimatedWordmark,
  getRgbPaletteForPhase,
} from './PlumbAnimatedWordmark.js';
import stripAnsi from 'strip-ansi';

describe('PlumbRgbAnsiPhase Deterministic RGB Animation Proof', () => {
  let oldForceColor: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    oldForceColor = process.env['FORCE_COLOR'];
    process.env['FORCE_COLOR'] = '3';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (oldForceColor !== undefined) {
      process.env['FORCE_COLOR'] = oldForceColor;
    } else {
      delete process.env['FORCE_COLOR'];
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

    expect(clean0).toBe(clean1);
    expect(clean0).toContain('████');
  });

  it('3. proves exactly 1 timer when mounted and 0 timers after unmount', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    const { unmount } = await renderWithProviders(
      <PlumbAnimatedWordmark fps={8} />,
    );

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});

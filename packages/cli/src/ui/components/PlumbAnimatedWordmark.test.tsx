/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// test-setup.ts freezes this component suite-wide so its 30fps timer can't
// destabilize unrelated suites; this is the one file that must exercise the
// real thing.
vi.unmock('./PlumbAnimatedWordmark.js');

import { renderWithProviders } from '../../test-utils/render.js';
import {
  PlumbAnimatedWordmark,
  buildFlowingPalette,
} from './PlumbAnimatedWordmark.js';
import {
  renderPlumbBlockWordmark,
  getBlockWordmarkWidth,
  getBlockWordmarkHeight,
} from '../../../../core/src/brand/index.js';

describe('PlumbAnimatedWordmark Component Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('1. renders exact Unicode PLUMB block wordmark', () => {
    const block = renderPlumbBlockWordmark();
    expect(block).toContain('████');
    expect(getBlockWordmarkWidth()).toBe(23);
    expect(getBlockWordmarkHeight()).toBe(5);
  });

  it('2. renders ASCII block fallback when requested', () => {
    const ascii = renderPlumbBlockWordmark({ useAscii: true });
    expect(ascii).toContain('####');
    expect(ascii).not.toContain('█');
  });

  it('3. uses one-line fallback when terminal width is narrow (< 60)', async () => {
    const { lastFrame } = await renderWithProviders(
      <PlumbAnimatedWordmark terminalWidth={40} isNarrow={true} />,
    );
    expect(lastFrame()?.trim()).toBe('PLUMB');
  });

  it('4. renders static wordmark when animation is disabled', async () => {
    const { lastFrame } = await renderWithProviders(
      <PlumbAnimatedWordmark disabled={true} phase={0} />,
    );
    const frame = lastFrame();
    expect(frame).toContain('█');
  });

  it('5. different phase values produce different rendered output', async () => {
    const { lastFrame: frame0 } = await renderWithProviders(
      <PlumbAnimatedWordmark phase={0} />,
    );
    const { lastFrame: frame1 } = await renderWithProviders(
      <PlumbAnimatedWordmark phase={1} />,
    );
    const text0 = frame0();
    const text1 = frame1();
    expect(text0).toContain('█');
    expect(text1).toContain('█');
    const block0 = renderPlumbBlockWordmark();
    const block1 = renderPlumbBlockWordmark();
    expect(block0).toBe(block1);
  });

  it('6. clears timer interval on unmount', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const { unmount } = await renderWithProviders(
      <PlumbAnimatedWordmark fps={8} />,
    );
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('7. NO_COLOR disables animation and renders clean ASCII text', async () => {
    const { lastFrame } = await renderWithProviders(
      <PlumbAnimatedWordmark noColor={true} />,
    );
    const frame = lastFrame();
    expect(frame).toContain('####');
    expect(frame).not.toContain('█');
  });

  it('8. screen-reader mode outputs only plain text PLUMB', async () => {
    const { lastFrame } = await renderWithProviders(
      <PlumbAnimatedWordmark screenReader={true} />,
    );
    expect(lastFrame()?.trim()).toBe('PLUMB');
  });

  it('9. deterministic phase prop overrides internal timer', async () => {
    const { lastFrame } = await renderWithProviders(
      <PlumbAnimatedWordmark phase={45} />,
    );
    expect(lastFrame()).toContain('█');
  });

  describe('flowing RGB palette', () => {
    it('produces valid hex colors', () => {
      for (const color of buildFlowingPalette(0)) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it('spans a range of hues within a single frame', () => {
      // A frame whose stops were all the same color would render as a flat
      // block, not a gradient.
      const palette = buildFlowingPalette(0);
      expect(new Set(palette).size).toBeGreaterThan(1);
    });

    it('advances by a small step between adjacent frames', () => {
      // The bug this replaced rotated a 3-5 entry array by one whole slot
      // per tick, so consecutive frames jumped a third of the way around
      // the palette and the mark strobed. Adjacent frames must now differ
      // only slightly -- proven here by requiring the first stop to move,
      // but by less than a coarse whole-slot rotation would move it.
      const first = buildFlowingPalette(0)[0];
      const second = buildFlowingPalette(1)[0];
      expect(second).not.toBe(first);

      const channelsOf = (hex: string) => [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
      const [r1, g1, b1] = channelsOf(first);
      const [r2, g2, b2] = channelsOf(second);
      const distance =
        Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(60);
    });

    it('returns to where it started after a full hue rotation', () => {
      // 360 degrees at 3 degrees per frame.
      expect(buildFlowingPalette(120)).toEqual(buildFlowingPalette(0));
    });
  });
});

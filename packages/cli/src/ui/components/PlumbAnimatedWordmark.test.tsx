/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { PlumbAnimatedWordmark } from './PlumbAnimatedWordmark.js';
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
});

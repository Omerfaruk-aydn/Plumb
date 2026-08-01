/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { PlumbAnimatedWordmark } from './PlumbAnimatedWordmark.js';
import stripAnsi from 'strip-ansi';

describe('PlumbAnimatedWordmark RGB Phase Tests', () => {
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

  it('1. different phase values produce same stripped text (characters unchanged)', async () => {
    const res0 = await renderWithProviders(<PlumbAnimatedWordmark phase={0} />);
    const raw0 = res0.lastFrame();
    const clean0 = stripAnsi(raw0);
    res0.unmount();

    const res1 = await renderWithProviders(<PlumbAnimatedWordmark phase={1} />);
    const raw1 = res1.lastFrame();
    const clean1 = stripAnsi(raw1);
    res1.unmount();

    expect(clean0).toBe(clean1);
    expect(clean0).toContain('████');
  });

  it('2. proves exactly 1 timer when mounted and 0 timers after unmount', async () => {
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

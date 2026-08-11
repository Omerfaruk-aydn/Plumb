/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { useValueChangeFlash } from './useValueChangeFlash.js';

describe('useValueChangeFlash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not flash on initial mount', async () => {
    const { result } = await renderHook(() => useValueChangeFlash('a'));
    expect(result.current).toBe(false);
  });

  it('flashes true right after the value changes, then settles back to false', async () => {
    const { result, rerender } = await renderHook(
      ({ value }) => useValueChangeFlash(value, 500),
      { initialProps: { value: 'a' } },
    );
    expect(result.current).toBe(false);

    rerender({ value: 'b' });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe(false);
  });

  it('does not flash again when re-rendered with the same value', async () => {
    const { result, rerender } = await renderHook(
      ({ value }) => useValueChangeFlash(value, 500),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'a' });
    expect(result.current).toBe(false);
  });

  it('restarts the flash timer if the value changes again mid-flash', async () => {
    const { result, rerender } = await renderHook(
      ({ value }) => useValueChangeFlash(value, 500),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'b' });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    rerender({ value: 'c' });
    expect(result.current).toBe(true);

    // Only 200ms further -- the original 500ms window would have elapsed,
    // but the timer restarted on the second change.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe(false);
  });
});

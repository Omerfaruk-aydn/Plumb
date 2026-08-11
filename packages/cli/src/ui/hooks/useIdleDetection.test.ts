/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderHookWithProviders } from '../../test-utils/render.js';
import { useIdleDetection } from './useIdleDetection.js';

describe('useIdleDetection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts not idle', async () => {
    const { result } = await renderHookWithProviders(() =>
      useIdleDetection(60_000, true),
    );
    expect(result.current).toBe(false);
  });

  it('becomes idle once the timeout elapses with no activity', async () => {
    const { result } = await renderHookWithProviders(() =>
      useIdleDetection(60_000, true),
    );

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(true);
  });

  it('does not become idle before the timeout elapses', async () => {
    const { result } = await renderHookWithProviders(() =>
      useIdleDetection(60_000, true),
    );

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe(false);
  });

  it('never goes idle when disabled', async () => {
    const { result } = await renderHookWithProviders(() =>
      useIdleDetection(60_000, false),
    );

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(result.current).toBe(false);
  });

  it('resets to not-idle when re-enabled after being disabled', async () => {
    const { result, rerender } = await renderHookWithProviders(
      ({ enabled }: { enabled: boolean }) => useIdleDetection(60_000, enabled),
      { initialProps: { enabled: false } },
    );
    expect(result.current).toBe(false);

    rerender({ enabled: true });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(true);
  });
});

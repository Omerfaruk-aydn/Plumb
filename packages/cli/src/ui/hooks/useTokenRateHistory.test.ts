/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { renderHookWithProviders } from '../../test-utils/render.js';
import { useTokenRateHistory } from './useTokenRateHistory.js';

describe('useTokenRateHistory', () => {
  it('records the initial value, even when it is zero', async () => {
    const { result } = await renderHookWithProviders(() =>
      useTokenRateHistory(0),
    );
    expect(result.current).toEqual([0]);
  });

  it('records the initial nonzero value', async () => {
    const { result } = await renderHookWithProviders(
      ({ count }: { count: number }) => useTokenRateHistory(count),
      { initialProps: { count: 100 } },
    );
    expect(result.current).toEqual([100]);
  });

  it('appends a new sample when the token count changes', async () => {
    const { result, rerender } = await renderHookWithProviders(
      ({ count }: { count: number }) => useTokenRateHistory(count),
      { initialProps: { count: 100 } },
    );

    rerender({ count: 150 });
    expect(result.current).toEqual([100, 150]);

    rerender({ count: 200 });
    expect(result.current).toEqual([100, 150, 200]);
  });

  it('does not append a duplicate sample when the count is unchanged', async () => {
    const { result, rerender } = await renderHookWithProviders(
      ({ count }: { count: number }) => useTokenRateHistory(count),
      { initialProps: { count: 100 } },
    );

    rerender({ count: 100 });
    expect(result.current).toEqual([100]);
  });

  it('caps history at maxSamples, dropping the oldest', async () => {
    const { result, rerender } = await renderHookWithProviders(
      ({ count }: { count: number }) => useTokenRateHistory(count, 3),
      { initialProps: { count: 1 } },
    );

    rerender({ count: 2 });
    rerender({ count: 3 });
    rerender({ count: 4 });

    expect(result.current).toEqual([2, 3, 4]);
  });
});

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { usePaletteCommand } from './usePaletteCommand.js';

describe('usePaletteCommand', () => {
  it('starts closed', async () => {
    const { result } = await renderHook(() => usePaletteCommand());
    expect(result.current.isPaletteOpen).toBe(false);
  });

  it('openPalette opens it, closePalette closes it', async () => {
    const { result } = await renderHook(() => usePaletteCommand());

    act(() => {
      result.current.openPalette();
    });
    expect(result.current.isPaletteOpen).toBe(true);

    act(() => {
      result.current.closePalette();
    });
    expect(result.current.isPaletteOpen).toBe(false);
  });
});

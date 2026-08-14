/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';

export interface UsePaletteCommandReturn {
  isPaletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
}

/** Open/close state for the command palette (F1). Deliberately minimal --
 * unlike theme/model dialogs, the palette has no committed selection to
 * revert on close, so there is nothing else to track here. */
export const usePaletteCommand = (): UsePaletteCommandReturn => {
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  const openPalette = useCallback(() => setIsPaletteOpen(true), []);
  const closePalette = useCallback(() => setIsPaletteOpen(false), []);

  return { isPaletteOpen, openPalette, closePalette };
};

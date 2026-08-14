/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';

const DEFAULT_FLASH_MS = 700;

/**
 * Returns `true` for a brief moment right after `value` changes (never on
 * the initial mount), then settles back to `false`. Meant for a one-shot
 * "this just changed" highlight -- e.g. briefly accenting the model name in
 * the footer right after a model switch -- not a continuous animation.
 *
 * Deliberately a single `setTimeout` per change, not a `setInterval`: this
 * is safe to use even on components mounted many times (unlike a repeating
 * timer -- see useColorCycle's docs for why that distinction matters).
 */
export function useValueChangeFlash(
  value: unknown,
  flashMs: number = DEFAULT_FLASH_MS,
): boolean {
  const [isFlashing, setIsFlashing] = useState(false);
  const previousValueRef = useRef(value);

  useEffect(() => {
    if (previousValueRef.current === value) {
      return;
    }
    previousValueRef.current = value;
    setIsFlashing(true);
    const timeout = setTimeout(() => setIsFlashing(false), flashMs);
    return () => clearTimeout(timeout);
  }, [value, flashMs]);

  return isFlashing;
}

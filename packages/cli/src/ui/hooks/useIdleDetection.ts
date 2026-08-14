/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeypress } from './useKeypress.js';

export function useIdleDetection(timeoutMs: number, enabled: boolean): boolean {
  const [isIdle, setIsIdle] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    setIsIdle(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (enabled) {
      timeoutRef.current = setTimeout(() => setIsIdle(true), timeoutMs);
    }
  }, [enabled, timeoutMs]);

  useEffect(() => {
    resetTimer();
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [resetTimer]);

  // Never consumes the keypress -- purely observes activity to reset the
  // idle timer, so it must not interfere with any other handler.
  useKeypress(
    () => {
      resetTimer();
      return false;
    },
    { isActive: enabled },
  );

  return enabled && isIdle;
}

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F25 (PLUMB-UI-DEVRIM-PROMPT.md): applies `ui.cursor` (DECSCUSR) while the
 * input prompt is mounted, restoring the terminal's own cursor on unmount.
 * A terminal that doesn't understand DECSCUSR simply ignores the escape
 * sequence, so no capability probe is needed before sending it.
 */
import { useEffect } from 'react';
import { setCursorStyle, resetCursorStyle } from '@plumb/core';
import { useSettings } from '../contexts/SettingsContext.js';
import { resolveCursorStyleCode } from '../utils/cursorStyle.js';

export function useCursorStyle(): void {
  const settings = useSettings();
  const style = settings.merged.ui?.cursor?.style;
  const blinking = settings.merged.ui?.cursor?.blinking;

  useEffect(() => {
    setCursorStyle(resolveCursorStyleCode(style, blinking));
    return () => {
      resetCursorStyle();
    };
  }, [style, blinking]);
}

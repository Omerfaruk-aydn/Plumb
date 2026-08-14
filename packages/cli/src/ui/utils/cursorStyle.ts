/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F25 (PLUMB-UI-DEVRIM-PROMPT.md): maps `ui.cursor` settings to a DECSCUSR
 * parameter (`terminal.ts`'s `setCursorStyle`/`resetCursorStyle`).
 */

export type CursorStyleName = 'default' | 'block' | 'underline' | 'line';

/** DECSCUSR reset -- restores whatever the terminal's own default cursor is. */
export const CURSOR_STYLE_RESET_CODE = 0;

export function resolveCursorStyleCode(
  style: CursorStyleName | undefined,
  blinking: boolean | undefined,
): number {
  if (!style || style === 'default') {
    return CURSOR_STYLE_RESET_CODE;
  }
  const steady = blinking === false;
  switch (style) {
    case 'block':
      return steady ? 2 : 1;
    case 'underline':
      return steady ? 4 : 3;
    case 'line':
      return steady ? 6 : 5;
    default:
      return CURSOR_STYLE_RESET_CODE;
  }
}

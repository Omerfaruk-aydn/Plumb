/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export const PLUMB_GLYPH_MAP = {
  P: ['████', '█  █', '████', '█   ', '█   '],
  L: ['█   ', '█   ', '█   ', '█   ', '████'],
  U: ['█  █', '█  █', '█  █', '█  █', '████'],
  M: ['█   █', '██ ██', '█ █ █', '█   █', '█   █'],
  B: ['████', '█  █', '████', '█  █', '████'],
} as const;

export const PLUMB_ASCII_GLYPH_MAP = {
  P: ['####', '#  #', '####', '#   ', '#   '],
  L: ['#   ', '#   ', '#   ', '#   ', '####'],
  U: ['#  #', '#  #', '#  #', '#  #', '####'],
  M: ['#   #', '## ##', '# # #', '#   #', '#   #'],
  B: ['####', '#  #', '####', '#  #', '####'],
} as const;

export interface RenderGlyphOptions {
  useAscii?: boolean;
}

export function renderPlumbBlockWordmark(
  options: RenderGlyphOptions = {},
): string {
  const map = options.useAscii ? PLUMB_ASCII_GLYPH_MAP : PLUMB_GLYPH_MAP;
  const word = ['P', 'L', 'U', 'M', 'B'] as const;
  const rows: string[] = [];

  for (let r = 0; r < 5; r++) {
    const rowStr = word.map((char) => map[char][r]).join(' ');
    rows.push(rowStr);
  }

  return rows.join('\n');
}

export function getBlockWordmarkWidth(): number {
  return 23;
}

export function getBlockWordmarkHeight(): number {
  return 5;
}

/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

export const BRAND_CONSTANTS = {
  PRODUCT_NAME: 'PLUMB',
  PRODUCT_TITLE: 'PLUMB CLI',
  CLI_COMMAND: 'plumb',
  LEGACY_CLI_COMMAND: 'gemini',
  CONFIG_DIR_NAME: '.plumb',
  LEGACY_CONFIG_DIR_NAME: '.gemini',
  ENV_PREFIX: 'PLUMB_',
  LEGACY_ENV_PREFIX: 'GEMINI_',
  SLOGAN_FORBIDDEN: true,
  DASHBOARD_BORDER_FORBIDDEN: true,
  ACTIVE_DEFAULT_LOGO: null, // Unselected — pending user visual selection

  LOGOS: {
    DIRECTION_A: {
      id: 'DIRECTION_A',
      name: 'Geometric P + Plumb Bob Monogram',
      lines: ['┌─┐', '│ │', '├─┘', '│  ', '▼  '],
      asciiLines: ['+-+', '| |', '+-+', '|  ', 'v  '],
      wordmark: 'P▼ PLUMB',
      width: 3,
      height: 5,
      screenReaderLabel: 'PLUMB Geometric P plumb monogram mark',
    },
    DIRECTION_B: {
      id: 'DIRECTION_B',
      name: 'L Alignment Mark',
      lines: ['│   ', '│   ', '└──▼'],
      asciiLines: ['|   ', '|   ', '+--v'],
      wordmark: 'L▼ PLUMB',
      width: 4,
      height: 3,
      screenReaderLabel: 'PLUMB L alignment plumb mark',
    },
    DIRECTION_C: {
      id: 'DIRECTION_C',
      name: 'Abstract Alignment Mark',
      lines: ['╷', '│', '◈'],
      asciiLines: ['|', '|', 'o'],
      wordmark: '╷◈ PLUMB',
      width: 1,
      height: 3,
      screenReaderLabel: 'PLUMB abstract alignment point mark',
    },
  },
} as const;

export type LogoCandidateId = keyof typeof BRAND_CONSTANTS.LOGOS;

export function renderBrandLogo(candidate?: LogoCandidateId, options: { noColor?: boolean } = {}): string {
  if (!candidate) {
    return 'PLUMB';
  }
  const logo = BRAND_CONSTANTS.LOGOS[candidate];
  if (!logo) return 'PLUMB';
  const lines = options.noColor ? logo.asciiLines : logo.lines;
  return lines.join('\n');
}

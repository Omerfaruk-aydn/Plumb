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
  ACTIVE_DEFAULT_LOGO: null, // Unselected — pending final user visual approval

  // Sole brand foundation: Direction A (Geometric P + Plumb Bob)
  // Directions B and C have been rejected and removed from runtime selection.
  LOGOS: {
    DIRECTION_A_WELCOME: {
      id: 'DIRECTION_A_WELCOME',
      name: 'Refined Geometric P Welcome Mark',
      lines: ['┌─┐ PLUMB', '│ │', '├─┘', '└─▼'],
      asciiLines: ['+-+ PLUMB', '| |', '+-+', '+-v'],
      wordmark: 'P▼ PLUMB',
      width: 9,
      height: 4,
      stemCol: 0,
      bobCol: 2,
      screenReaderLabel: 'PLUMB Geometric P welcome plumb mark',
    },
    DIRECTION_A_COMPACT: {
      id: 'DIRECTION_A_COMPACT',
      name: 'Refined Geometric P Compact Header',
      lines: ['┌─┐ PLUMB', '└─▼'],
      asciiLines: ['+-+ PLUMB', '+-v'],
      wordmark: 'P▼ PLUMB',
      width: 9,
      height: 2,
      stemCol: 0,
      bobCol: 2,
      screenReaderLabel: 'PLUMB Geometric P compact header mark',
    },
    DIRECTION_A_MICRO: {
      id: 'DIRECTION_A_MICRO',
      name: 'Refined Geometric P Micro Mark',
      lines: ['┌─┐', '└─▼'],
      asciiLines: ['+-+', '+-v'],
      wordmark: 'P▼',
      width: 3,
      height: 2,
      stemCol: 0,
      bobCol: 2,
      screenReaderLabel: 'PLUMB Geometric P micro mark',
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

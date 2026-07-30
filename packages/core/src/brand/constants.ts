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

  // Locked Visual System: Typography-First PLUMB Wordmark with True Vertical Plumb Line
  LOGOS: {
    TYPOGRAPHIC_WELCOME: {
      id: 'TYPOGRAPHIC_WELCOME',
      name: 'PLUMB Typographic Welcome Mark',
      lines: ['PLUMB', '│', '◆'],
      asciiLines: ['PLUMB', '|', 'v'],
      wordmark: 'PLUMB',
      width: 5,
      height: 3,
      stemCol: 0,
      lineCol: 0,
      bobCol: 0,
      screenReaderLabel: 'PLUMB typographic welcome mark',
    },
    TYPOGRAPHIC_COMPACT: {
      id: 'TYPOGRAPHIC_COMPACT',
      name: 'PLUMB Compact Header Mark',
      lines: ['PLUMB'],
      asciiLines: ['PLUMB'],
      wordmark: 'PLUMB',
      width: 5,
      height: 1,
      stemCol: 0,
      lineCol: 0,
      bobCol: 0,
      screenReaderLabel: 'PLUMB compact header mark',
    },
    TYPOGRAPHIC_MICRO: {
      id: 'TYPOGRAPHIC_MICRO',
      name: 'PLUMB Micro Alignment Mark',
      lines: ['│', '◆'],
      asciiLines: ['|', 'v'],
      wordmark: '│◆',
      width: 1,
      height: 2,
      stemCol: 0,
      lineCol: 0,
      bobCol: 0,
      screenReaderLabel: 'PLUMB micro mark',
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

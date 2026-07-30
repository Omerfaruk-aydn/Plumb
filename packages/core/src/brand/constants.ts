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

  LOGOS: {
    CANDIDATE_A: {
      id: 'A',
      name: 'ASCII Minimalist Plumb',
      lines: [' | | ', '|---|', ' \\v/ '],
      width: 5,
      height: 3,
      screenReaderLabel: 'PLUMB ASCII alignment mark',
    },
    CANDIDATE_B: {
      id: 'B',
      name: 'Unicode Precision Plumb',
      lines: [' │ │ ', '├─┼─┤', '  ▼  '],
      width: 5,
      height: 3,
      screenReaderLabel: 'PLUMB vertical alignment mark',
    },
    CANDIDATE_C: {
      id: 'C',
      name: 'Compact One-Line Identity',
      lines: ['PLUMB │▼│'],
      width: 9,
      height: 1,
      screenReaderLabel: 'PLUMB compact mark',
    },
  },
} as const;

export type LogoCandidateId = keyof typeof BRAND_CONSTANTS.LOGOS;

export function renderBrandLogo(candidate: LogoCandidateId = 'CANTIDATE_B' as any, options: { noColor?: boolean } = {}): string {
  const logo = BRAND_CONSTANTS.LOGOS[candidate] || BRAND_CONSTANTS.LOGOS.CANDIDATE_B;
  return logo.lines.join('\n');
}

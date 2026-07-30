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
    NEW_CANDIDATE_A: {
      id: 'NEW_CANDIDATE_A',
      name: 'Pure Vertical Minimal Plumb',
      lines: [' │ ', ' │ ', ' ◆ '],
      width: 3,
      height: 3,
      screenReaderLabel: 'PLUMB pure vertical alignment mark',
    },
    NEW_CANDIDATE_B: {
      id: 'NEW_CANDIDATE_B',
      name: 'ASCII Plumb Line',
      lines: [' | ', ' | ', ' v '],
      width: 3,
      height: 3,
      screenReaderLabel: 'PLUMB ASCII vertical plumb mark',
    },
    NEW_CANDIDATE_C: {
      id: 'NEW_CANDIDATE_C',
      name: 'Original Compact PLUMB Monogram',
      lines: [' ╎P╎', '  ▼ '],
      width: 4,
      height: 2,
      screenReaderLabel: 'PLUMB suspended monogram mark',
    },
  },
} as const;

export type LogoCandidateId = keyof typeof BRAND_CONSTANTS.LOGOS;

export function renderBrandLogo(candidate?: LogoCandidateId, options: { noColor?: boolean } = {}): string {
  if (!candidate) {
    return 'PLUMB'; // Text fallback when no candidate is selected by user
  }
  const logo = BRAND_CONSTANTS.LOGOS[candidate];
  return logo ? logo.lines.join('\n') : 'PLUMB';
}

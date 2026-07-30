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
  ACTIVE_DEFAULT_LOGO: null, // Unselected — pending final user approval

  // Wordmark-Only Terminal System: No symbolic logo machinery
  LOGOS: {},
} as const;

export function renderBrandLogo(_candidate?: string, _options: { noColor?: boolean } = {}): string {
  return 'PLUMB';
}

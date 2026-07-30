/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { BRAND_CONSTANTS, type LogoCandidateId } from './constants.js';

export interface LogoRenderOptions {
  candidate?: LogoCandidateId;
  noColor?: boolean;
}

export function getLogoPrimitive(candidate?: LogoCandidateId, options: LogoRenderOptions = {}): string {
  if (!candidate) {
    return 'PLUMB';
  }
  const logo = BRAND_CONSTANTS.LOGOS[candidate];
  if (!logo) return 'PLUMB';
  const lines = options.noColor ? logo.asciiLines : logo.lines;
  return lines.join('\n');
}

export function getLogoWordmark(candidate?: LogoCandidateId): string {
  if (!candidate) {
    return 'PLUMB';
  }
  const logo = BRAND_CONSTANTS.LOGOS[candidate];
  return logo ? logo.wordmark : 'PLUMB';
}

export function getLogoWidth(candidate?: LogoCandidateId): number {
  if (!candidate) {
    return 5;
  }
  const logo = BRAND_CONSTANTS.LOGOS[candidate];
  return logo ? logo.width : 5;
}

export function getLogoHeight(candidate?: LogoCandidateId): number {
  if (!candidate) {
    return 1;
  }
  const logo = BRAND_CONSTANTS.LOGOS[candidate];
  return logo ? logo.height : 1;
}

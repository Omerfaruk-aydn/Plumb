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

export function isRejectedDirection(directionId: string): boolean {
  return directionId === 'DIRECTION_A' || directionId === 'DIRECTION_B' || directionId === 'DIRECTION_C';
}

export function isBobStemAligned(candidate: LogoCandidateId): boolean {
  const logo = BRAND_CONSTANTS.LOGOS[candidate];
  if (!logo) return false;
  return logo.stemCol === logo.lineCol && logo.lineCol === logo.bobCol;
}

export function verifyLogoGeometry(candidate: LogoCandidateId): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const logo = BRAND_CONSTANTS.LOGOS[candidate];
  if (!logo) {
    errors.push(`Unknown logo candidate: ${candidate}`);
    return { valid: false, errors };
  }

  if (logo.stemCol !== logo.lineCol || logo.lineCol !== logo.bobCol) {
    errors.push(`Stem (${logo.stemCol}), Line (${logo.lineCol}), and Bob (${logo.bobCol}) columns must be identical.`);
  }

  if (logo.height > 3 && candidate === 'TYPOGRAPHIC_WELCOME') {
    errors.push(`Welcome logo height (${logo.height}) exceeds 3 rows maximum.`);
  }

  if (logo.width > 2 && candidate === 'TYPOGRAPHIC_MICRO') {
    errors.push(`Micro logo width (${logo.width}) exceeds 2 columns maximum.`);
  }

  return { valid: errors.length === 0, errors };
}

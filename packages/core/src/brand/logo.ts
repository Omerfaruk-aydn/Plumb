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

export function getLogoPrimitive(candidate: LogoCandidateId = 'CANDIDATE_B'): string {
  const logo = BRAND_CONSTANTS.LOGOS[candidate] || BRAND_CONSTANTS.LOGOS.CANDIDATE_B;
  return logo.lines.join('\n');
}

export function getLogoWidth(candidate: LogoCandidateId = 'CANDIDATE_B'): number {
  const logo = BRAND_CONSTANTS.LOGOS[candidate] || BRAND_CONSTANTS.LOGOS.CANDIDATE_B;
  return logo.width;
}

export function getLogoHeight(candidate: LogoCandidateId = 'CANDIDATE_B'): number {
  const logo = BRAND_CONSTANTS.LOGOS[candidate] || BRAND_CONSTANTS.LOGOS.CANDIDATE_B;
  return logo.height;
}

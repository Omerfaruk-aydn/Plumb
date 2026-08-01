/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface LogoRenderOptions {
  candidate?: string;
  noColor?: boolean;
}

export function getLogoPrimitive(
  _candidate?: string,
  _options: LogoRenderOptions = {},
): string {
  return 'PLUMB';
}

export function getLogoWordmark(_candidate?: string): string {
  return 'PLUMB';
}

export function isSymbolicLogoRejected(candidateId?: string): boolean {
  if (!candidateId) return false;
  const rejected = [
    'DIRECTION_A',
    'DIRECTION_B',
    'DIRECTION_C',
    'TYPOGRAPHIC_WELCOME',
    'TYPOGRAPHIC_COMPACT',
    'TYPOGRAPHIC_MICRO',
    'BOXED_P',
  ];
  return rejected.includes(candidateId);
}

export function verifyWordmarkOnly(): boolean {
  return getLogoPrimitive() === 'PLUMB' && getLogoWordmark() === 'PLUMB';
}

export function getLogoWidth(_candidate?: string): number {
  return 3;
}

export function getLogoHeight(_candidate?: string): number {
  return 3;
}

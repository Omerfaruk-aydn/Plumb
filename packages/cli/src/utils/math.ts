/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export const lerp = (start: number, end: number, t: number): number =>
  start + (end - start) * t;

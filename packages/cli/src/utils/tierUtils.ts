/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export function isUltraTier(tierName?: string): boolean {
  return !!tierName?.toLowerCase().includes('ultra');
}

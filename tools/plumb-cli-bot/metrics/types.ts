/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MetricOutput {
  metric: string;
  value: number | string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export const GITHUB_OWNER = 'Omerfaruk-aydn';
export const GITHUB_REPO = 'Plumb';

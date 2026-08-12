/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F5 (PLUMB-UI-DEVRIM-PROMPT.md) sparkline rendering. Pure function over
 * whatever samples the caller already collected -- no timer, no
 * animation; it just draws whatever numbers it's given.
 */

const SPARK_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

export function renderSparkline(values: readonly number[]): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range === 0) {
    // All samples equal -- render a flat mid-height line rather than
    // dividing by zero.
    return SPARK_BLOCKS[Math.floor(SPARK_BLOCKS.length / 2)].repeat(
      values.length,
    );
  }

  return values
    .map((v) => {
      const normalized = (v - min) / range;
      const index = Math.round(normalized * (SPARK_BLOCKS.length - 1));
      return SPARK_BLOCKS[
        Math.max(0, Math.min(SPARK_BLOCKS.length - 1, index))
      ];
    })
    .join('');
}

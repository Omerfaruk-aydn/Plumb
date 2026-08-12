/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { renderSparkline } from './sparkline.js';

describe('renderSparkline', () => {
  it('returns an empty string for no samples', () => {
    expect(renderSparkline([])).toBe('');
  });

  it('renders one character per sample', () => {
    expect(renderSparkline([1, 2, 3, 4, 5])).toHaveLength(5);
  });

  it('maps the minimum value to the lowest block and the maximum to the highest', () => {
    const result = renderSparkline([10, 50, 100]);
    expect(result[0]).toBe('▁');
    expect(result[2]).toBe('█');
  });

  it('renders a flat mid-height line when every sample is equal', () => {
    const result = renderSparkline([42, 42, 42]);
    expect(result).toBe('▅▅▅');
  });

  it('is monotonic for monotonically increasing input', () => {
    const blocks = '▁▂▃▄▅▆▇█';
    const result = renderSparkline([0, 25, 50, 75, 100]);
    const indices = Array.from(result).map((c) => blocks.indexOf(c));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
    }
  });
});

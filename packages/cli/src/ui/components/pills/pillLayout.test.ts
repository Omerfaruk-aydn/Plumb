/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  fitPills,
  flattenDetail,
  pillFixedWidth,
  pillWidth,
  sampleGradient,
  MAX_MARKS,
  type Pill,
} from './pillLayout.js';

const todo: Pill = {
  id: 'todo',
  tag: 'TODO',
  value: '3/7',
  detail: 'refactor the authentication flow end to end',
  marks: 0,
};

const queue: Pill = {
  id: 'queue',
  tag: 'QUEUE',
  value: '3',
  detail: 'also update the changelog',
  marks: 3,
};

describe('pill widths', () => {
  it('counts the padding inside each filled block', () => {
    // ` TODO ` (6) + ` 3/7 ` (5), sharing an edge
    expect(pillFixedWidth({ ...todo, detail: undefined })).toBe(11);
  });

  it('counts progress marks inside the value block', () => {
    // ` QUEUE ` (7) + ` ▶▶▶ 3 ` (7)
    expect(pillFixedWidth({ ...queue, detail: undefined })).toBe(14);
  });

  it('caps marks so a long queue cannot widen the pill without bound', () => {
    const many = { ...queue, marks: 40, detail: undefined };
    const capped = { ...queue, marks: MAX_MARKS, detail: undefined };
    expect(pillFixedWidth(many)).toBe(pillFixedWidth(capped));
  });

  it('adds the detail and its leading gap', () => {
    expect(pillWidth(todo)).toBe(
      pillFixedWidth({ ...todo, detail: undefined }) + 1 + todo.detail!.length,
    );
  });
});

describe('fitPills', () => {
  it('returns both pills untouched when they fit', () => {
    const fitted = fitPills([todo, queue], 200);
    expect(fitted).toEqual([todo, queue]);
  });

  it('never returns a row wider than the budget', () => {
    // Every width from "comfortable" down to "nothing survives" must hold the
    // invariant. A single hand-picked width would not have caught the padding
    // being left out of the fixed-width calculation.
    for (let width = 0; width <= 120; width++) {
      const fitted = fitPills([todo, queue], width);
      const used = fitted.reduce(
        (sum, pill, index) => sum + pillWidth(pill) + (index > 0 ? 1 : 0),
        0,
      );
      expect(used).toBeLessThanOrEqual(width);
    }
  });

  it('shortens details before dropping anything', () => {
    const fitted = fitPills([todo, queue], 60);
    expect(fitted.map((pill) => pill.id)).toEqual(['todo', 'queue']);
    expect(fitted.some((pill) => pill.detail?.endsWith('…'))).toBe(true);
  });

  it('sheds the queue pill before the todo pill', () => {
    const fitted = fitPills([todo, queue], 16);
    expect(fitted.map((pill) => pill.id)).toEqual(['todo']);
  });

  it('renders nothing rather than a clipped pill', () => {
    // 8 columns cannot hold even a bare ` TODO  3/7 `, and half of one reads
    // as a rendering fault rather than as missing information.
    expect(fitPills([todo, queue], 8)).toEqual([]);
  });

  it('returns nothing for a zero or negative budget', () => {
    expect(fitPills([todo], 0)).toEqual([]);
    expect(fitPills([todo], -5)).toEqual([]);
  });

  it('does not mutate the pills it was given', () => {
    const original = { ...todo };
    fitPills([todo, queue], 50);
    expect(todo).toEqual(original);
  });

  it('measures double-width detail text by column, not character count', () => {
    const wide: Pill = { ...todo, detail: '日本語のタスクをここに書く' };
    const fitted = fitPills([wide], 30);
    expect(pillWidth(fitted[0])).toBeLessThanOrEqual(30);
  });
});

describe('flattenDetail', () => {
  it('collapses newlines so a pasted paragraph stays one row tall', () => {
    expect(flattenDetail('first line\n\n  second line\t')).toBe(
      'first line second line',
    );
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(flattenDetail('  \n ')).toBe('');
  });
});

describe('sampleGradient', () => {
  const gradient = ['#100000', '#200000', '#300000', '#400000'];

  it('spans the whole gradient, endpoints included', () => {
    const colors = sampleGradient(gradient, 4, '#fff');
    expect(colors[0]).toBe('#100000');
    expect(colors[colors.length - 1]).toBe('#400000');
  });

  it('still spans end to end when sampling fewer marks than stops', () => {
    expect(sampleGradient(gradient, 2, '#fff')).toEqual(['#100000', '#400000']);
  });

  it('gives a single mark the brightest stop', () => {
    expect(sampleGradient(gradient, 1, '#fff')).toEqual(['#400000']);
  });

  it('falls back to a flat color when the theme defines no gradient', () => {
    expect(sampleGradient(undefined, 3, '#abcdef')).toEqual([
      '#abcdef',
      '#abcdef',
      '#abcdef',
    ]);
    expect(sampleGradient([], 2, '#abcdef')).toEqual(['#abcdef', '#abcdef']);
  });

  it('returns nothing for a non-positive count', () => {
    expect(sampleGradient(gradient, 0, '#fff')).toEqual([]);
  });
});

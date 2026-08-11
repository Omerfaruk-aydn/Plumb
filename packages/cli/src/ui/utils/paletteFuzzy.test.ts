/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { fuzzyScore, rankByFuzzyScore } from './paletteFuzzy.js';

describe('fuzzyScore', () => {
  it('matches a case-insensitive substring and returns contiguous indices', () => {
    const result = fuzzyScore('help', 'The Help Command');
    expect(result).not.toBeNull();
    expect(result!.matchedIndices).toEqual([4, 5, 6, 7]);
  });

  it('matches a non-contiguous subsequence', () => {
    const result = fuzzyScore('hlp', 'help');
    expect(result).not.toBeNull();
    expect(result!.matchedIndices).toEqual([0, 2, 3]);
  });

  it('returns null when query is not a subsequence at all', () => {
    expect(fuzzyScore('xyz', 'help')).toBeNull();
  });

  it('ranks a full substring match above a scattered subsequence match', () => {
    const substring = fuzzyScore('cmd', 'cmd-runner');
    const scattered = fuzzyScore('cmd', 'camelDropped');
    expect(substring).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(substring!.score).toBeGreaterThan(scattered!.score);
  });

  it('gives a prefix match a higher score than a mid-string match', () => {
    const prefix = fuzzyScore('mod', 'model');
    const midString = fuzzyScore('mod', 'the model');
    expect(prefix).not.toBeNull();
    expect(midString).not.toBeNull();
    expect(prefix!.score).toBeGreaterThan(midString!.score);
  });

  it('gives consecutive subsequence matches a higher score than spread-out ones', () => {
    const consecutive = fuzzyScore('abc', 'xabcx');
    const spread = fuzzyScore('abc', 'xaxbxcx');
    expect(consecutive).not.toBeNull();
    expect(spread).not.toBeNull();
    expect(consecutive!.score).toBeGreaterThan(spread!.score);
  });

  it('treats an empty query as matching everything with score 0', () => {
    expect(fuzzyScore('', 'anything')).toEqual({
      score: 0,
      matchedIndices: [],
    });
  });
});

describe('rankByFuzzyScore', () => {
  interface Item {
    id: string;
  }
  const items: Item[] = [{ id: 'help' }, { id: 'history' }, { id: 'theme' }];

  it('returns every item, unranked, in original order for an empty query', () => {
    const ranked = rankByFuzzyScore(items, '', (i) => i.id);
    expect(ranked.map((r) => r.item.id)).toEqual(['help', 'history', 'theme']);
  });

  it('filters out non-matching items and sorts matches best-first', () => {
    const ranked = rankByFuzzyScore(items, 'his', (i) => i.id);
    expect(ranked.map((r) => r.item.id)).toEqual(['history']);
  });

  it('excludes items with no subsequence match at all', () => {
    const ranked = rankByFuzzyScore(items, 'zzz', (i) => i.id);
    expect(ranked).toEqual([]);
  });
});

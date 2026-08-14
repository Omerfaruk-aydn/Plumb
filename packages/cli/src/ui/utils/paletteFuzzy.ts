/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface FuzzyMatch {
  /** Higher is a better match. Only meaningful relative to other scores
   * for the same query. */
  score: number;
  /** Indices into `text` (not `query`) that matched, in order. */
  matchedIndices: number[];
}

/**
 * Scores `text` against `query` as a case-insensitive subsequence match.
 * Returns `null` when `query` is not a subsequence of `text` at all.
 *
 * Scoring, highest to lowest weight:
 * - a full contiguous substring match
 * - matches starting right at the beginning of `text`
 * - consecutive matched characters (a run bonus, so "cmd" ranks "command"
 *   above "camelCased")
 */
export function fuzzyScore(query: string, text: string): FuzzyMatch | null {
  if (query.length === 0) {
    return { score: 0, matchedIndices: [] };
  }

  const q = query.toLowerCase();
  const t = text.toLowerCase();

  const substringIndex = t.indexOf(q);
  if (substringIndex !== -1) {
    const matchedIndices = Array.from(
      { length: q.length },
      (_, i) => substringIndex + i,
    );
    let score = 100 + q.length; // longer exact substrings rank higher
    if (substringIndex === 0) score += 50; // prefix bonus
    return { score, matchedIndices };
  }

  // Fall back to subsequence matching with a run-length bonus.
  const matchedIndices: number[] = [];
  let qi = 0;
  let currentRun = 0;
  let runBonus = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matchedIndices.push(ti);
      qi++;
      currentRun++;
      runBonus += currentRun; // consecutive matches compound
    } else {
      currentRun = 0;
    }
  }

  if (qi !== q.length) {
    return null;
  }

  let score = runBonus;
  if (matchedIndices[0] === 0) score += 20; // prefix bonus
  return { score, matchedIndices };
}

export interface RankedItem<T> {
  item: T;
  match: FuzzyMatch;
}

/**
 * Filters and ranks `items` against `query` using `getText` to extract the
 * searchable string from each. Empty query returns every item, unranked,
 * in its original order (score 0, no highlights) -- the palette's "browse
 * everything" state.
 */
export function rankByFuzzyScore<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
): Array<RankedItem<T>> {
  if (query.trim().length === 0) {
    return items.map((item) => ({
      item,
      match: { score: 0, matchedIndices: [] },
    }));
  }

  const ranked: Array<RankedItem<T>> = [];
  for (const item of items) {
    const match = fuzzyScore(query.trim(), getText(item));
    if (match) {
      ranked.push({ item, match });
    }
  }
  ranked.sort((a, b) => b.match.score - a.match.score);
  return ranked;
}

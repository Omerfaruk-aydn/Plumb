/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getCachedStringWidth,
  truncateToWidth,
} from '../../utils/textUtils.js';

/**
 * A pill is a single-row, filled tag summarising something that is *currently
 * in flight* -- a todo list being worked through, messages waiting their turn.
 *
 * Crush draws these above its editor (internal/tui, pills) as bordered boxes
 * three rows tall. PLUMB's composer renders inline in the scrollback rather
 * than in an alternate buffer, so three rows per pill is rent the user pays on
 * every frame for information that is one line long. These are filled
 * single-row tags instead, matching the mode badges on the prompt: filled
 * means "a state you are in", which is exactly what a running todo list is.
 */
export interface Pill {
  /** Stable identity, also used to pick the tone at render time. */
  readonly id: PillId;
  /** Short knocked-out label, e.g. `TODO`. */
  readonly tag: string;
  /** The number that carries the pill's meaning, e.g. `3/7`. */
  readonly value: string;
  /**
   * Elastic trailing text (the in-progress task, the queued message). This is
   * the only part that may be shortened or dropped to make a row fit.
   */
  readonly detail?: string;
  /**
   * Leading progress glyphs, rendered one per queued item across the theme
   * gradient. Empty for pills that don't count discrete items.
   */
  readonly marks: number;
}

export type PillId = 'todo' | 'queue';

/**
 * Padding inside a filled block: one column each side, so text never touches
 * the color edge.
 */
const BLOCK_PADDING = 2;

/** Gap between the tag block and the value block, and between pills. */
const GAP = 1;

/** A detail shorter than this reads as noise rather than context. */
const MIN_DETAIL_WIDTH = 8;

/** Cap on progress marks; past this the count carries the meaning, not the glyphs. */
export const MAX_MARKS = 9;

/**
 * Drop order when a row does not fit. Later entries are shed first, so the
 * todo pill -- which answers "how far through the plan am I" -- outlives the
 * queue pill, which the user can also infer from having just pressed Enter.
 */
const SHED_ORDER: readonly PillId[] = ['queue', 'todo'];

function blockWidth(text: string): number {
  return getCachedStringWidth(text) + BLOCK_PADDING;
}

/**
 * Contents of the value block: the progress marks, when there are any, then
 * the value itself. Marks live inside the block rather than beside it so the
 * whole count reads as one object: `▶▶▶ 3`, not `▶▶▶` next to a stray `3`.
 */
function valueContentWidth(pill: Pill): number {
  const marks = Math.min(pill.marks, MAX_MARKS);
  const marksWidth = marks > 0 ? marks + GAP : 0;
  return marksWidth + getCachedStringWidth(pill.value);
}

/**
 * Width of a pill with its detail removed -- the part that cannot shrink.
 *
 * The tag and value blocks share an edge with no gap between them: that
 * shared edge is what makes the two tones read as one pill rather than as two
 * unrelated tags that happen to be adjacent.
 */
export function pillFixedWidth(pill: Pill): number {
  return blockWidth(pill.tag) + valueContentWidth(pill) + BLOCK_PADDING;
}

/** Width of a pill including its detail, as it would render right now. */
export function pillWidth(pill: Pill): number {
  if (!pill.detail) return pillFixedWidth(pill);
  return pillFixedWidth(pill) + GAP + getCachedStringWidth(pill.detail);
}

function totalWidth(pills: readonly Pill[]): number {
  if (pills.length === 0) return 0;
  const gaps = (pills.length - 1) * GAP;
  return pills.reduce((sum, pill) => sum + pillWidth(pill), gaps);
}

/**
 * Fits `pills` into `availableWidth`, degrading in the order a reader would
 * accept: shorten details, then drop details entirely, then drop whole pills.
 *
 * A pill is never truncated mid-block. Half a `3/7` is worse than no pill --
 * it looks like a rendering bug, and the reader cannot tell which half they
 * are looking at.
 */
export function fitPills(
  pills: readonly Pill[],
  availableWidth: number,
): Pill[] {
  if (availableWidth <= 0) return [];

  let fitted = pills.filter((pill) => pill.tag.length > 0);
  if (fitted.length === 0) return [];

  // 1. Everything already fits.
  if (totalWidth(fitted) <= availableWidth) return [...fitted];

  // 2. Shrink details, longest first, down to the readable minimum.
  fitted = shrinkDetails(fitted, availableWidth);
  if (totalWidth(fitted) <= availableWidth) return fitted;

  // 3. Drop details outright, in shed order.
  for (const id of SHED_ORDER) {
    fitted = fitted.map((pill) =>
      pill.id === id && pill.detail ? { ...pill, detail: undefined } : pill,
    );
    if (totalWidth(fitted) <= availableWidth) return fitted;
  }

  // 4. Drop whole pills, in shed order, keeping at least the survivor that
  //    fits. If even one bare pill overflows, render nothing: a clipped pill
  //    misleads, an absent one merely omits.
  for (const id of SHED_ORDER) {
    fitted = fitted.filter((pill) => pill.id !== id);
    if (totalWidth(fitted) <= availableWidth) return fitted;
  }

  return [];
}

function shrinkDetails(pills: readonly Pill[], availableWidth: number): Pill[] {
  const result = pills.map((pill) => ({ ...pill }));
  let overflow = totalWidth(result) - availableWidth;

  // Longest detail first: taking 20 columns off a long task title costs less
  // legibility than taking 5 off a short one.
  const byDetailLength = result
    .map((pill, index) => ({ index, detail: pill.detail ?? '' }))
    .filter((entry) => entry.detail.length > 0)
    .sort(
      (a, b) => getCachedStringWidth(b.detail) - getCachedStringWidth(a.detail),
    );

  for (const entry of byDetailLength) {
    if (overflow <= 0) break;
    const current = getCachedStringWidth(entry.detail);
    const target = Math.max(MIN_DETAIL_WIDTH, current - overflow);
    if (target >= current) continue;
    const shortened = truncateToWidth(entry.detail, target);
    result[entry.index].detail = shortened;
    overflow -= current - getCachedStringWidth(shortened);
  }

  return result;
}

/**
 * Collapses whitespace so a multi-line queued message renders as one line.
 * Without this a pasted paragraph would blow the row height out to match the
 * paste, which is the opposite of what a pill is for.
 */
export function flattenDetail(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Picks `count` colors spread across `gradient`, so a run of progress marks
 * reads as a ramp rather than a block of one color.
 *
 * Falls back to a single repeated color when the theme defines no gradient --
 * every builtin theme is required to have one, but a user theme need not.
 */
export function sampleGradient(
  gradient: readonly string[] | undefined,
  count: number,
  fallback: string,
): string[] {
  if (count <= 0) return [];
  if (!gradient || gradient.length === 0) {
    return Array.from({ length: count }, () => fallback);
  }
  if (count === 1) return [gradient[gradient.length - 1]];

  return Array.from({ length: count }, (_unused, index) => {
    const position = (index / (count - 1)) * (gradient.length - 1);
    return gradient[Math.round(position)];
  });
}

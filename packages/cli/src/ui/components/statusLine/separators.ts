/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Separator vocabulary for the status line, modeled on oh-my-pi's
 * (packages/coding-agent/src/modes/components/status-line/separators.ts).
 *
 * A separator is not just a glyph: powerline styles also decide how color
 * flows across the boundary. In a filled powerline bar the arrow between
 * two segments is drawn in the *previous* segment's background over the
 * *next* segment's background, which is what makes the shapes interlock
 * instead of reading as arrows sitting on a strip.
 */

export type SeparatorStyle =
  | 'powerline'
  | 'powerline-thin'
  | 'slash'
  | 'pipe'
  | 'block'
  | 'dot'
  | 'none'
  | 'ascii';

export interface SeparatorSpec {
  /** Glyph drawn between two segments of a left-aligned run. */
  readonly left: string;
  /** Glyph drawn between two segments of a right-aligned run. */
  readonly right: string;
  /**
   * True for filled powerline shapes: the glyph is painted with the
   * outgoing segment's background as its foreground, over the incoming
   * segment's background. False for plain rules, which are drawn in a
   * neutral color on the bar's own ground.
   */
  readonly chainsColor: boolean;
  /**
   * True when segments carry a filled background at all. Only powerline
   * styles do; the rest render as colored text on the bar's ground, which
   * is far more readable in terminals with limited color fidelity.
   */
  readonly filled: boolean;
}

/**
 * Nerd Font private-use glyphs. These are the canonical powerline shapes
 * and only render correctly in a patched font -- `resolveSeparator`
 * degrades to the geometric-shapes fallbacks below when Nerd Font support
 * isn't confirmed, rather than emitting tofu.
 */
const NERD = {
  solidLeft: '',
  solidRight: '',
  thinLeft: '',
  thinRight: '',
} as const;

/** Geometric-shapes fallbacks, available in essentially any Unicode font. */
const UNICODE = {
  solidLeft: '▶',
  solidRight: '◀',
  thinLeft: '❯',
  thinRight: '❮',
} as const;

export const SEPARATORS: Record<SeparatorStyle, SeparatorSpec> = {
  powerline: {
    left: NERD.solidLeft,
    right: NERD.solidRight,
    chainsColor: true,
    filled: true,
  },
  'powerline-thin': {
    left: NERD.thinLeft,
    right: NERD.thinRight,
    chainsColor: false,
    filled: true,
  },
  slash: { left: '/', right: '/', chainsColor: false, filled: false },
  pipe: { left: '│', right: '│', chainsColor: false, filled: false },
  block: { left: '▌', right: '▐', chainsColor: false, filled: false },
  dot: { left: '·', right: '·', chainsColor: false, filled: false },
  none: { left: ' ', right: ' ', chainsColor: false, filled: false },
  ascii: { left: '>', right: '<', chainsColor: false, filled: false },
};

/**
 * Resolves the spec actually safe to draw with, downgrading Nerd Font
 * shapes when the terminal hasn't been confirmed to have them.
 *
 * Terminals lie about their capabilities more often than not, so the
 * signal here is an explicit opt-in (`hasNerdFont`) rather than sniffing:
 * a wrong guess renders every separator as a replacement box, which is
 * far worse than a plain `▶`.
 */
export function resolveSeparator(
  style: SeparatorStyle,
  hasNerdFont: boolean,
): SeparatorSpec {
  const spec = SEPARATORS[style];
  if (hasNerdFont) return spec;
  if (style === 'powerline') {
    return { ...spec, left: UNICODE.solidLeft, right: UNICODE.solidRight };
  }
  if (style === 'powerline-thin') {
    return { ...spec, left: UNICODE.thinLeft, right: UNICODE.thinRight };
  }
  return spec;
}

/** Narrows an arbitrary settings string to a known separator style. */
export function isSeparatorStyle(value: string): value is SeparatorStyle {
  return Object.hasOwn(SEPARATORS, value);
}

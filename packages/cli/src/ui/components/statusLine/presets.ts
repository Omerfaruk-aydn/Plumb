/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SeparatorStyle } from './separators.js';

/**
 * Named status line layouts, modeled on oh-my-pi's presets
 * (packages/coding-agent/src/modes/components/status-line/presets.ts).
 *
 * A preset is a starting point, not a cage: `ui.footer.items` still wins
 * when the user has set it. The value of naming layouts is that "show me
 * more" / "show me less" is one word instead of hand-ordering twelve ids.
 *
 * `left` runs from the left edge; `right` is right-aligned against the
 * opposite edge, so the bar stays anchored at both ends instead of
 * trailing off with a ragged gap.
 */
export interface StatusLinePreset {
  readonly left: readonly string[];
  readonly right: readonly string[];
  readonly separator: SeparatorStyle;
  readonly description: string;
}

export const STATUS_LINE_PRESETS = {
  minimal: {
    left: ['workspace', 'git-branch'],
    right: ['model-name'],
    separator: 'slash',
    description: 'Just where you are and what you are talking to.',
  },
  compact: {
    left: ['workspace', 'git-branch', 'model-name'],
    right: ['context-used'],
    separator: 'powerline-thin',
    description: 'Adds context usage to the essentials.',
  },
  default: {
    left: ['workspace', 'git-branch', 'sandbox'],
    right: ['model-name', 'context-used'],
    separator: 'powerline-thin',
    description: 'Balanced: location, safety posture, model and context.',
  },
  full: {
    left: ['workspace', 'git-branch', 'sandbox', 'code-changes'],
    right: ['token-count', 'model-name', 'context-used', 'quota'],
    separator: 'powerline',
    description: 'Filled powerline with session accounting.',
  },
  nerd: {
    left: ['hostname', 'workspace', 'git-branch', 'sandbox', 'code-changes'],
    right: [
      'token-count',
      'memory-usage',
      'model-name',
      'context-used',
      'quota',
      'session-id',
    ],
    separator: 'powerline',
    description: 'Everything, for a wide terminal with a patched font.',
  },
  ascii: {
    left: ['workspace', 'git-branch', 'sandbox'],
    right: ['model-name', 'context-used'],
    separator: 'ascii',
    description: 'No box-drawing or powerline glyphs at all.',
  },
} as const satisfies Record<string, StatusLinePreset>;

export type StatusLinePresetName = keyof typeof STATUS_LINE_PRESETS;

export const DEFAULT_PRESET: StatusLinePresetName = 'default';

export function isStatusLinePresetName(
  name: string,
): name is StatusLinePresetName {
  return Object.hasOwn(STATUS_LINE_PRESETS, name);
}

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text } from 'ink';
import { theme } from '../../semantic-colors.js';

/**
 * Input modes worth signalling. Each either changes what Enter does
 * (shell, search) or what happens to the result without further asking
 * (yolo, accept), or restricts it (plan).
 */
export type InputMode =
  | 'prompt'
  | 'shell'
  | 'yolo'
  | 'search'
  | 'plan'
  | 'accept';

interface ModeBadgeProps {
  readonly mode: InputMode;
  /** Screen-reader label for the prefix, when the caller supplies one. */
  readonly ariaLabel?: string;
}

/**
 * Filled, knocked-out mode tag for the input prompt, following Crush's
 * editor styles (internal/ui/styles/quickstyle.go), where bang and
 * question modes render as `Background(primary).Bold(true).SetString(" ! ")`
 * rather than as a bare colored glyph.
 *
 * The distinction matters because these modes change the meaning of the
 * Enter key: a lone `!` in accent color reads as decoration, while a
 * filled tag reads as a state you are currently *in*. Getting that wrong
 * costs the user a shell command they did not intend to run.
 */
export const ModeBadge: React.FC<ModeBadgeProps> = ({ mode, ariaLabel }) => {
  if (mode === 'prompt') {
    // The default mode earns no tag -- a badge on every single line is
    // noise, and "not in a special mode" is the absence of a signal.
    return (
      <Text color={theme.text.accent} aria-label={ariaLabel}>
        {'❯ '}
      </Text>
    );
  }

  const { glyph, background } =
    mode === 'shell'
      ? { glyph: '!', background: theme.status.error }
      : mode === 'yolo'
        ? { glyph: '*', background: theme.status.warning }
        : mode === 'plan'
          ? { glyph: 'P', background: theme.status.success }
          : mode === 'accept'
            ? { glyph: 'A', background: theme.status.warning }
            : { glyph: '⌕', background: theme.text.link };

  // Exactly two columns, matching InputPrompt's PROMPT_PREFIX_WIDTH: the
  // caret must not shift as modes change, and the surrounding layout
  // budgets its width against that constant. Crush's own tags are wider
  // (` ! ` plus a separate `:::` run), but it does not share this
  // fixed-width prefix contract.
  return (
    <Text aria-label={ariaLabel}>
      <Text color={theme.background.primary} backgroundColor={background} bold>
        {glyph}
      </Text>{' '}
    </Text>
  );
};

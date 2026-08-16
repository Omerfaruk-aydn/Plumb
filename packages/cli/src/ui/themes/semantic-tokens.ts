/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { lightTheme, darkTheme } from './theme.js';

export interface SemanticColors {
  text: {
    primary: string;
    secondary: string;
    link: string;
    accent: string;
    response: string;
  };
  background: {
    primary: string;
    message: string;
    input: string;
    focus: string;
    diff: {
      added: string;
      removed: string;
    };
    /**
     * Status-tinted row surfaces (see ColorsTheme's UserMessageBackground
     * &co). Optional: a theme that doesn't define them renders those rows
     * with no background at all rather than a substituted color.
     */
    userMessage?: string;
    toolPending?: string;
    toolSuccess?: string;
    toolError?: string;
    /** Status line's own ground, when the theme defines one. */
    statusLine?: string;
  };
  border: {
    default: string;
  };
  ui: {
    comment: string;
    symbol: string;
    active: string;
    dark: string;
    focus: string;
    gradient: string[] | undefined;
  };
  status: {
    error: string;
    success: string;
    warning: string;
  };
  /**
   * Per-field status line hues (see ColorsTheme's StatusLine* fields).
   * Each is optional; a caller must fall back to a generic color rather
   * than inventing one when a theme leaves them unset.
   */
  statusLine?: {
    model?: string;
    path?: string;
    gitClean?: string;
    gitDirty?: string;
    context?: string;
    cost?: string;
  };
}

export const lightSemanticColors: SemanticColors = {
  text: {
    primary: lightTheme.Foreground,
    secondary: lightTheme.Gray,
    link: lightTheme.AccentBlue,
    accent: lightTheme.AccentPurple,
    response: lightTheme.Foreground,
  },
  background: {
    primary: lightTheme.Background,
    message: lightTheme.MessageBackground!,
    input: lightTheme.InputBackground!,
    focus: lightTheme.FocusBackground!,
    diff: {
      added: lightTheme.DiffAdded,
      removed: lightTheme.DiffRemoved,
    },
    userMessage: lightTheme.UserMessageBackground,
    toolPending: lightTheme.ToolPendingBackground,
    toolSuccess: lightTheme.ToolSuccessBackground,
    toolError: lightTheme.ToolErrorBackground,
    statusLine: lightTheme.StatusLineBackground,
  },
  border: {
    default: lightTheme.DarkGray,
  },
  ui: {
    comment: lightTheme.Comment,
    symbol: lightTheme.Gray,
    active: lightTheme.AccentBlue,
    dark: lightTheme.DarkGray,
    focus: lightTheme.AccentGreen,
    gradient: lightTheme.GradientColors,
  },
  status: {
    error: lightTheme.AccentRed,
    success: lightTheme.AccentGreen,
    warning: lightTheme.AccentYellow,
  },
  statusLine: {
    model: lightTheme.StatusLineModel,
    path: lightTheme.StatusLinePath,
    gitClean: lightTheme.StatusLineGitClean,
    gitDirty: lightTheme.StatusLineGitDirty,
    context: lightTheme.StatusLineContext,
    cost: lightTheme.StatusLineCost,
  },
};

export const darkSemanticColors: SemanticColors = {
  text: {
    primary: darkTheme.Foreground,
    secondary: darkTheme.Gray,
    link: darkTheme.AccentBlue,
    accent: darkTheme.AccentPurple,
    response: darkTheme.Foreground,
  },
  background: {
    primary: darkTheme.Background,
    message: darkTheme.MessageBackground!,
    input: darkTheme.InputBackground!,
    focus: darkTheme.FocusBackground!,
    diff: {
      added: darkTheme.DiffAdded,
      removed: darkTheme.DiffRemoved,
    },
    userMessage: darkTheme.UserMessageBackground,
    toolPending: darkTheme.ToolPendingBackground,
    toolSuccess: darkTheme.ToolSuccessBackground,
    toolError: darkTheme.ToolErrorBackground,
    statusLine: darkTheme.StatusLineBackground,
  },
  border: {
    default: darkTheme.DarkGray,
  },
  ui: {
    comment: darkTheme.Comment,
    symbol: darkTheme.Gray,
    active: darkTheme.AccentBlue,
    dark: darkTheme.DarkGray,
    focus: darkTheme.AccentGreen,
    gradient: darkTheme.GradientColors,
  },
  status: {
    error: darkTheme.AccentRed,
    success: darkTheme.AccentGreen,
    warning: darkTheme.AccentYellow,
  },
  statusLine: {
    model: darkTheme.StatusLineModel,
    path: darkTheme.StatusLinePath,
    gitClean: darkTheme.StatusLineGitClean,
    gitDirty: darkTheme.StatusLineGitDirty,
    context: darkTheme.StatusLineContext,
    cost: darkTheme.StatusLineCost,
  },
};

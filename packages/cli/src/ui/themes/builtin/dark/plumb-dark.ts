/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { darkTheme, Theme } from '../../theme.js';

export const PlumbDark: Theme = new Theme(
  'PLUMB',
  'dark',
  {
    hljs: {
      display: 'block',
      overflowX: 'auto',
      padding: '0.5em',
      background: darkTheme.Background,
      color: darkTheme.Foreground,
    },
    'hljs-keyword': {
      color: darkTheme.AccentCyan,
    },
    'hljs-literal': {
      color: darkTheme.AccentCyan,
    },
    'hljs-symbol': {
      color: darkTheme.AccentBlue,
    },
    'hljs-name': {
      color: darkTheme.AccentBlue,
    },
    'hljs-link': {
      color: darkTheme.AccentBlue,
      textDecoration: 'underline',
    },
    'hljs-built_in': {
      color: darkTheme.AccentCyan,
    },
    'hljs-type': {
      color: darkTheme.AccentCyan,
    },
    'hljs-number': {
      color: darkTheme.AccentGreen,
    },
    'hljs-class': {
      color: darkTheme.AccentGreen,
    },
    'hljs-string': {
      color: darkTheme.AccentYellow,
    },
    'hljs-meta-string': {
      color: darkTheme.AccentYellow,
    },
    'hljs-regexp': {
      color: darkTheme.AccentRed,
    },
    'hljs-template-tag': {
      color: darkTheme.AccentRed,
    },
    'hljs-subst': {
      color: darkTheme.Foreground,
    },
    'hljs-comment': {
      color: darkTheme.Comment,
    },
    'hljs-doctag': {
      color: darkTheme.Comment,
    },
    'hljs-meta': {
      color: darkTheme.Comment,
    },
    'hljs-title': {
      color: darkTheme.AccentBlue,
    },
    'hljs-section': {
      color: darkTheme.AccentBlue,
    },
    'hljs-selector-id': {
      color: darkTheme.AccentBlue,
    },
    'hljs-title.class_': {
      color: darkTheme.AccentGreen,
    },
    'hljs-title.class_.inherited__': {
      color: darkTheme.AccentGreen,
    },
    'hljs-title.function_': {
      color: darkTheme.AccentBlue,
    },
    'hljs-attr': {
      color: darkTheme.AccentBlue,
    },
    'hljs-attribute': {
      color: darkTheme.AccentBlue,
    },
    'hljs-variable': {
      color: darkTheme.Foreground,
    },
    'hljs-template-variable': {
      color: darkTheme.Foreground,
    },
    'hljs-selector-class': {
      color: darkTheme.AccentYellow,
    },
    'hljs-selector-attr': {
      color: darkTheme.AccentYellow,
    },
    'hljs-selector-pseudo': {
      color: darkTheme.AccentYellow,
    },
    'hljs-addition': {
      color: darkTheme.AccentGreen,
    },
    'hljs-deletion': {
      color: darkTheme.AccentRed,
    },
  },
  darkTheme,
);

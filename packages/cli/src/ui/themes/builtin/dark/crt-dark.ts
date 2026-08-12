/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F17 (PLUMB-UI-DEVRIM-PROMPT.md): a retro green-phosphor CRT terminal
 * look, built the same way every other builtin theme in this directory
 * is (a ColorsTheme + hljs class-name -> color mappings) -- no new
 * infrastructure, just a new theme entry.
 */
import { type ColorsTheme, Theme } from '../../theme.js';
import { interpolateColor } from '../../color-utils.js';

const crtColors: ColorsTheme = {
  type: 'dark',
  Background: '#001100',
  Foreground: '#33ff33',
  LightBlue: '#33ff99',
  AccentBlue: '#33ff99',
  AccentPurple: '#66ff66',
  AccentCyan: '#33ff99',
  AccentGreen: '#00ff00',
  AccentYellow: '#ffb000',
  AccentRed: '#ff4d4d',
  DiffAdded: '#003300',
  DiffRemoved: '#330000',
  Comment: '#008800',
  Gray: '#00b300',
  DarkGray: interpolateColor('#00b300', '#001100', 0.5),
  GradientColors: ['#33ff33', '#00ff00'],
};

export const CRT: Theme = new Theme(
  'CRT',
  'dark',
  {
    hljs: {
      display: 'block',
      overflowX: 'auto',
      padding: '0.5em',
      background: crtColors.Background,
      color: crtColors.Foreground,
    },
    'hljs-keyword': {
      color: crtColors.AccentGreen,
      fontWeight: 'bold',
    },
    'hljs-selector-tag': {
      color: crtColors.AccentGreen,
      fontWeight: 'bold',
    },
    'hljs-literal': {
      color: crtColors.AccentGreen,
      fontWeight: 'bold',
    },
    'hljs-section': {
      color: crtColors.AccentGreen,
      fontWeight: 'bold',
    },
    'hljs-link': {
      color: crtColors.AccentCyan,
    },
    'hljs-function .hljs-keyword': {
      color: crtColors.AccentPurple,
    },
    'hljs-subst': {
      color: crtColors.Foreground,
    },
    'hljs-string': {
      color: crtColors.AccentYellow,
    },
    'hljs-title': {
      color: crtColors.AccentYellow,
      fontWeight: 'bold',
    },
    'hljs-name': {
      color: crtColors.AccentYellow,
      fontWeight: 'bold',
    },
    'hljs-type': {
      color: crtColors.AccentCyan,
      fontWeight: 'bold',
    },
    'hljs-attribute': {
      color: crtColors.AccentYellow,
    },
    'hljs-symbol': {
      color: crtColors.AccentYellow,
    },
    'hljs-bullet': {
      color: crtColors.AccentYellow,
    },
    'hljs-addition': {
      color: crtColors.AccentGreen,
    },
    'hljs-variable': {
      color: crtColors.Foreground,
    },
    'hljs-template-tag': {
      color: crtColors.AccentYellow,
    },
    'hljs-template-variable': {
      color: crtColors.AccentYellow,
    },
    'hljs-comment': {
      color: crtColors.Comment,
      fontStyle: 'italic',
    },
    'hljs-quote': {
      color: crtColors.Comment,
      fontStyle: 'italic',
    },
    'hljs-deletion': {
      color: crtColors.AccentRed,
    },
    'hljs-meta': {
      color: crtColors.Comment,
    },
    'hljs-doctag': {
      fontWeight: 'bold',
    },
    'hljs-strong': {
      fontWeight: 'bold',
    },
    'hljs-emphasis': {
      fontStyle: 'italic',
    },
  },
  crtColors,
);

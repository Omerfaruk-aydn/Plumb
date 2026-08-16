/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { theme } from '../../semantic-colors.js';

/**
 * Presentation facts for each status line field: which hue identifies it,
 * how hard it fights to stay on screen, and which edge it anchors to.
 *
 * Modeled on oh-my-pi's status line, where every segment carries its own
 * theme color key (statusLineModel, statusLinePath, statusLineGitClean,
 * ...) rather than the row sharing one shade -- a field you can find by
 * hue costs a glance, one you must read costs a sentence.
 */
export interface SegmentMeta {
  /** Resolves the field's hue against the live theme. */
  readonly color: () => string;
  /**
   * Survival rank when the row must shed fields. "Where am I" and "what
   * am I talking to" outrank session accounting: a bar that drops those
   * first has stopped doing its job while still occupying a line.
   */
  readonly priority: number;
  /** Edge the field anchors to when a preset does not say otherwise. */
  readonly side: 'left' | 'right';
}

/**
 * Fallbacks matter here: a theme that defines no statusLine palette must
 * still produce a legible, differentiated row, so each entry falls back
 * to the closest generic semantic color rather than to one shared default.
 */
export const SEGMENT_META: Record<string, SegmentMeta> = {
  workspace: {
    color: () => theme.statusLine?.path ?? theme.ui.active,
    priority: 90,
    side: 'left',
  },
  'git-branch': {
    color: () => theme.statusLine?.gitClean ?? theme.status.success,
    priority: 80,
    side: 'left',
  },
  'code-changes': {
    color: () => theme.statusLine?.gitDirty ?? theme.status.warning,
    priority: 60,
    side: 'left',
  },
  sandbox: {
    color: () => theme.status.warning,
    priority: 40,
    side: 'left',
  },
  hostname: {
    color: () => theme.ui.comment,
    priority: 25,
    side: 'left',
  },
  'model-name': {
    color: () => theme.statusLine?.model ?? theme.text.accent,
    priority: 100,
    side: 'right',
  },
  'context-used': {
    color: () => theme.statusLine?.context ?? theme.text.secondary,
    priority: 70,
    side: 'right',
  },
  quota: {
    color: () => theme.statusLine?.cost ?? theme.text.secondary,
    priority: 50,
    side: 'right',
  },
  'token-count': {
    color: () => theme.statusLine?.cost ?? theme.text.secondary,
    priority: 45,
    side: 'right',
  },
  auth: {
    color: () => theme.text.accent,
    priority: 30,
    side: 'right',
  },
  'memory-usage': {
    color: () => theme.ui.comment,
    priority: 20,
    side: 'right',
  },
  'session-id': {
    color: () => theme.ui.comment,
    priority: 15,
    side: 'right',
  },
};

/**
 * Metadata for a field id, including ones not in the table above
 * (custom/extension items): those get a neutral hue and the lowest
 * priority, so they render correctly but never crowd out a core field.
 */
export function metaFor(id: string): SegmentMeta {
  return (
    SEGMENT_META[id] ?? {
      color: () => theme.ui.comment,
      priority: 10,
      side: 'left',
    }
  );
}

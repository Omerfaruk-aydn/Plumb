/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  parseWorktreeStatus,
  isCleanWorktree,
  CLEAN_WORKTREE,
} from './useGitWorktreeStatus.js';

describe('parseWorktreeStatus', () => {
  it('reports a clean tree for empty output', () => {
    expect(parseWorktreeStatus('')).toEqual(CLEAN_WORKTREE);
    expect(isCleanWorktree(parseWorktreeStatus(''))).toBe(true);
  });

  it('counts staged, dirty and untracked files into separate buckets', () => {
    // Column 1 is the index state, column 2 the worktree state.
    const porcelain = [
      'M  staged-only.ts',
      ' M dirty-only.ts',
      '?? brand-new.ts',
      'A  added.ts',
      ' D deleted-in-worktree.ts',
    ].join('\n');

    expect(parseWorktreeStatus(porcelain)).toEqual({
      staged: 2,
      dirty: 2,
      untracked: 1,
    });
  });

  it('counts a file that is both staged and further modified in both buckets', () => {
    // `MM` genuinely is both: there are staged changes AND newer unstaged
    // ones. Reporting it once would hide half the state.
    expect(parseWorktreeStatus('MM both.ts')).toEqual({
      staged: 1,
      dirty: 1,
      untracked: 0,
    });
  });

  it('does not count an untracked file as staged or dirty', () => {
    // '?' appears in both columns for untracked files and must not be
    // mistaken for a status code.
    expect(parseWorktreeStatus('?? a.ts\n?? b.ts')).toEqual({
      staged: 0,
      dirty: 0,
      untracked: 2,
    });
  });

  it('ignores blank and truncated lines rather than miscounting them', () => {
    expect(parseWorktreeStatus('\n\nM  real.ts\n\n')).toEqual({
      staged: 1,
      dirty: 0,
      untracked: 0,
    });
  });

  it('treats renames as staged changes', () => {
    expect(parseWorktreeStatus('R  old.ts -> new.ts')).toEqual({
      staged: 1,
      dirty: 0,
      untracked: 0,
    });
  });
});

describe('isCleanWorktree', () => {
  it('is true only when every bucket is empty', () => {
    expect(isCleanWorktree({ staged: 0, dirty: 0, untracked: 0 })).toBe(true);
    expect(isCleanWorktree({ staged: 1, dirty: 0, untracked: 0 })).toBe(false);
    expect(isCleanWorktree({ staged: 0, dirty: 1, untracked: 0 })).toBe(false);
    expect(isCleanWorktree({ staged: 0, dirty: 0, untracked: 1 })).toBe(false);
  });
});

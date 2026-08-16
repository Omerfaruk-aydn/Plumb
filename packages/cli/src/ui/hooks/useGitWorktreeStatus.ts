/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { spawnAsync } from '@plumb/core';

/**
 * Counts of files in each working-tree state, as oh-my-pi's status line
 * reports them (its theme colors staged/dirty/untracked separately:
 * statusLineStaged, statusLineDirty, statusLineUntracked).
 *
 * A bare branch name answers "which branch"; these answer "is there
 * anything here I have not committed", which is the question that
 * actually changes what a user does next.
 */
export interface GitWorktreeStatus {
  /** Files with staged changes (index differs from HEAD). */
  readonly staged: number;
  /** Tracked files modified but not staged. */
  readonly dirty: number;
  /** Files git does not track yet. */
  readonly untracked: number;
}

export const CLEAN_WORKTREE: GitWorktreeStatus = {
  staged: 0,
  dirty: 0,
  untracked: 0,
};

export function isCleanWorktree(status: GitWorktreeStatus): boolean {
  return status.staged === 0 && status.dirty === 0 && status.untracked === 0;
}

/**
 * Parses `git status --porcelain=v1` output.
 *
 * Each line's first two columns are the index and worktree states
 * respectively, so a single file can be counted in more than one bucket
 * (staged an edit, then edited it again) -- that is accurate, not
 * double-counting: it really is both.
 */
export function parseWorktreeStatus(porcelain: string): GitWorktreeStatus {
  let staged = 0;
  let dirty = 0;
  let untracked = 0;

  for (const line of porcelain.split('\n')) {
    if (line.length < 2) continue;
    const index = line[0];
    const worktree = line[1];
    if (index === '?' && worktree === '?') {
      untracked++;
      continue;
    }
    if (index !== ' ' && index !== '?') staged++;
    if (worktree !== ' ' && worktree !== '?') dirty++;
  }

  return { staged, dirty, untracked };
}

/** Debounce for refreshes triggered by rapid successive edits. */
const REFRESH_DEBOUNCE_MS = 1_000;

/**
 * Tracks working-tree counts for `cwd`, refreshed on an interval.
 *
 * Polls rather than watching the filesystem: a worktree changes on every
 * keystroke-triggered save across a whole tree, and a watcher on a large
 * repo costs far more than one cheap `git status` between renders. The
 * interval is deliberately slow -- this is ambient context, not something
 * the user is waiting on.
 */
export function useGitWorktreeStatus(
  cwd: string,
  enabled: boolean,
  pollIntervalMs = 5_000,
): GitWorktreeStatus {
  const [status, setStatus] = useState<GitWorktreeStatus>(CLEAN_WORKTREE);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { stdout } = await spawnAsync(
        'git',
        ['status', '--porcelain=v1', '--untracked-files=normal'],
        { cwd },
      );
      setStatus(parseWorktreeStatus(stdout.toString()));
    } catch {
      // Not a repo, git missing, or the command failed -- report clean
      // rather than stale counts from a previous directory.
      setStatus(CLEAN_WORKTREE);
    }
  }, [cwd]);

  useEffect(() => {
    if (!enabled) {
      setStatus(CLEAN_WORKTREE);
      return undefined;
    }

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void refresh();
      timeoutRef.current = setTimeout(tick, pollIntervalMs);
    };
    // Slight initial delay so startup isn't competing with a git spawn.
    timeoutRef.current = setTimeout(tick, REFRESH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [enabled, refresh, pollIntervalMs]);

  return status;
}

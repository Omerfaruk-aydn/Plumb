/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * A path-shaped claim the model made about the codebase, and whether it
 * actually checks out.
 *
 * Deliberately narrow: only backtick-quoted spans that look like a path
 * (contain a `/` and end in a plausible extension) are considered. Bare
 * words in prose and symbol/function-name claims (`` `doThing()` ``) are
 * left alone -- both are far too easy to false-positive on (a hypothetical
 * suggestion, a library or built-in name, pseudo-code), and a check that
 * cries wolf trains the user to ignore it. A path is a much sharper signal:
 * it either resolves on disk or it doesn't.
 */
export interface GroundedPathClaim {
  path: string;
  exists: boolean;
}

const QUOTED_PATH_PATTERN = /`((?:[\w.-]+\/)+[\w.-]+\.[a-zA-Z]{1,8})`/g;

/**
 * Pulls backtick-quoted, path-shaped tokens out of assistant prose.
 *
 * This is a syntactic filter, not a grounding check by itself -- it only
 * decides what's *worth* checking. A plausible-looking match that isn't
 * actually a real path claim (e.g. a made-up example path in an
 * explanation) is exactly what `checkGroundedPaths` is for.
 */
export function extractQuotedPathClaims(text: string): string[] {
  const matches = new Set<string>();
  for (const match of text.matchAll(QUOTED_PATH_PATTERN)) {
    matches.add(match[1]);
  }
  return [...matches];
}

/**
 * Resolves each candidate path against every given root (workspace roots,
 * plural, since a multi-folder workspace makes "relative to cwd" ambiguous)
 * and reports whether it exists under any of them. An already-absolute path
 * is checked as-is, ignoring the roots.
 */
export async function checkGroundedPaths(
  candidatePaths: readonly string[],
  roots: readonly string[],
): Promise<GroundedPathClaim[]> {
  return Promise.all(
    candidatePaths.map(async (candidate) => ({
      path: candidate,
      exists: await pathExistsUnderAnyRoot(candidate, roots),
    })),
  );
}

async function pathExistsUnderAnyRoot(
  candidate: string,
  roots: readonly string[],
): Promise<boolean> {
  const absoluteCandidates = path.isAbsolute(candidate)
    ? [candidate]
    : roots.map((root) => path.join(root, candidate));

  for (const absolute of absoluteCandidates) {
    try {
      await fs.access(absolute);
      return true;
    } catch {
      // Not under this root; try the next one.
    }
  }
  return false;
}

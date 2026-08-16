/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  extractQuotedPathClaims,
  checkGroundedPaths,
} from './groundingCheck.js';

describe('extractQuotedPathClaims', () => {
  it('extracts a backtick-quoted, path-shaped token', () => {
    expect(
      extractQuotedPathClaims(
        'I found the bug in `packages/core/src/foo/bar.ts`.',
      ),
    ).toEqual(['packages/core/src/foo/bar.ts']);
  });

  it('ignores bare words in prose that are not backtick-quoted', () => {
    expect(
      extractQuotedPathClaims('The file packages/core/src/foo/bar.ts has it.'),
    ).toEqual([]);
  });

  it('ignores backtick-quoted symbols that are not path-shaped', () => {
    // No slash -- looks like a function name, not a path claim.
    expect(extractQuotedPathClaims('Call `doThing()` first.')).toEqual([]);
  });

  it('ignores a single bare word in backticks with no extension', () => {
    expect(extractQuotedPathClaims('Run `eslint` on it.')).toEqual([]);
  });

  it('deduplicates repeated claims', () => {
    const text = 'See `src/a/b.ts` and again `src/a/b.ts`.';
    expect(extractQuotedPathClaims(text)).toEqual(['src/a/b.ts']);
  });

  it('extracts multiple distinct claims', () => {
    const text = 'Changed `src/a/b.ts` and `src/c/d.tsx`.';
    expect(extractQuotedPathClaims(text)).toEqual([
      'src/a/b.ts',
      'src/c/d.tsx',
    ]);
  });
});

describe('checkGroundedPaths', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grounding-test-'));
    await fs.mkdir(path.join(tmpDir, 'src', 'a'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'src', 'a', 'real.ts'), '');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reports a relative path that exists under the root as grounded', async () => {
    const results = await checkGroundedPaths(['src/a/real.ts'], [tmpDir]);
    expect(results).toEqual([{ path: 'src/a/real.ts', exists: true }]);
  });

  it('reports a relative path that does not exist as ungrounded', async () => {
    const results = await checkGroundedPaths(['src/a/fake.ts'], [tmpDir]);
    expect(results).toEqual([{ path: 'src/a/fake.ts', exists: false }]);
  });

  it('checks an absolute path directly, ignoring the roots', async () => {
    const absolute = path.join(tmpDir, 'src', 'a', 'real.ts');
    const results = await checkGroundedPaths([absolute], ['/nonexistent']);
    expect(results).toEqual([{ path: absolute, exists: true }]);
  });

  it('falls through to a later root when earlier roots do not have the file', async () => {
    const results = await checkGroundedPaths(
      ['src/a/real.ts'],
      ['/nonexistent-root', tmpDir],
    );
    expect(results).toEqual([{ path: 'src/a/real.ts', exists: true }]);
  });

  it('returns one result per input, preserving order', async () => {
    const results = await checkGroundedPaths(
      ['src/a/real.ts', 'src/a/fake.ts'],
      [tmpDir],
    );
    expect(results.map((r) => r.path)).toEqual([
      'src/a/real.ts',
      'src/a/fake.ts',
    ]);
  });
});

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpHome: string;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => tmpHome };
});

import {
  getBenchmarksFilePath,
  loadBenchmarkEntry,
  loadAllBenchmarkEntries,
  saveBenchmarkEntry,
  BENCHMARK_FIXTURE_VERSION,
  type BenchmarkEntry,
} from './storage.js';

function makeEntry(overrides: Partial<BenchmarkEntry> = {}): BenchmarkEntry {
  return {
    provider: 'google',
    modelId: 'gemini-2.5-pro',
    scorePct: 94,
    fixtureVersion: BENCHMARK_FIXTURE_VERSION,
    measuredAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    fixtureResults: [{ id: 'off-by-one', scorePct: 100 }],
    ...overrides,
  };
}

describe('bench storage (storage roundtrip / bozuk JSON toparlanması)', () => {
  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'plumb-bench-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('returns undefined / empty when no benchmarks file exists yet', async () => {
    expect(
      await loadBenchmarkEntry('google', 'gemini-2.5-pro'),
    ).toBeUndefined();
    expect(await loadAllBenchmarkEntries()).toEqual({});
  });

  it('round-trips a saved entry back out exactly', async () => {
    const entry = makeEntry();
    await saveBenchmarkEntry(entry);

    const loaded = await loadBenchmarkEntry(entry.provider, entry.modelId);
    expect(loaded).toEqual(entry);

    const all = await loadAllBenchmarkEntries();
    expect(Object.keys(all)).toHaveLength(1);
  });

  it('accumulates entries for different models without clobbering each other', async () => {
    await saveBenchmarkEntry(
      makeEntry({ modelId: 'gemini-2.5-pro', scorePct: 94 }),
    );
    await saveBenchmarkEntry(
      makeEntry({ modelId: 'gemini-2.5-flash', scorePct: 88 }),
    );

    const all = await loadAllBenchmarkEntries();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all['google:gemini-2.5-pro'].scorePct).toBe(94);
    expect(all['google:gemini-2.5-flash'].scorePct).toBe(88);
  });

  it('recovers from a corrupt benchmarks.json by treating it as empty', async () => {
    const filePath = getBenchmarksFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{ this is not valid json', 'utf-8');

    expect(await loadAllBenchmarkEntries()).toEqual({});

    // And saving afterward still works -- the corrupt file gets overwritten.
    await saveBenchmarkEntry(makeEntry());
    expect(await loadAllBenchmarkEntries()).not.toEqual({});
  });

  it('recovers from a valid-JSON-but-wrong-shape file the same way', async () => {
    const filePath = getBenchmarksFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ notEntries: true }), 'utf-8');

    expect(await loadAllBenchmarkEntries()).toEqual({});
  });
});

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F26 (PLUMB-UI-DEVRIM-PROMPT.md): reads/writes `~/.plumb/benchmarks.json`
 * -- the only persisted record of `/bench` results. Corrupt or missing
 * files are treated as "no data yet" rather than thrown errors, matching
 * the "bozuk JSON toparlanması" edge case.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const PLUMB_DIR = '.plumb';
const BENCHMARKS_FILE = 'benchmarks.json';

/** Bump when BENCHMARK_FIXTURES changes meaningfully -- stored results from
 * an older fixture set are shown as stale rather than compared apples-to-oranges. */
export const BENCHMARK_FIXTURE_VERSION = 'v1';

export function getBenchmarksFilePath(): string {
  return path.join(os.homedir(), PLUMB_DIR, BENCHMARKS_FILE);
}

export interface BenchmarkFixtureResult {
  id: string;
  scorePct: number;
}

export interface BenchmarkEntry {
  provider: string;
  modelId: string;
  scorePct: number;
  fixtureVersion: string;
  measuredAt: string;
  fixtureResults: BenchmarkFixtureResult[];
}

interface BenchmarkStoreFile {
  version: 1;
  entries: Record<string, BenchmarkEntry>;
}

function isBenchmarkStoreFile(value: unknown): value is BenchmarkStoreFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'entries' in value &&
    typeof (value as { entries: unknown }).entries === 'object' &&
    (value as { entries: unknown }).entries !== null
  );
}

export function benchmarkKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

async function readStore(): Promise<BenchmarkStoreFile> {
  try {
    const content = await fs.readFile(getBenchmarksFilePath(), 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (isBenchmarkStoreFile(parsed)) {
      return parsed;
    }
  } catch {
    // Missing file or corrupt JSON: treat as "no benchmarks yet".
  }
  return { version: 1, entries: {} };
}

async function writeStore(store: BenchmarkStoreFile): Promise<void> {
  const filePath = getBenchmarksFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
}

export async function loadBenchmarkEntry(
  provider: string,
  modelId: string,
): Promise<BenchmarkEntry | undefined> {
  const store = await readStore();
  return store.entries[benchmarkKey(provider, modelId)];
}

export async function loadAllBenchmarkEntries(): Promise<
  Record<string, BenchmarkEntry>
> {
  const store = await readStore();
  return store.entries;
}

export async function saveBenchmarkEntry(entry: BenchmarkEntry): Promise<void> {
  const store = await readStore();
  store.entries[benchmarkKey(entry.provider, entry.modelId)] = entry;
  await writeStore(store);
}

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F26 (PLUMB-UI-DEVRIM-PROMPT.md): formats a `/bench` result for display in
 * SearchableModelPicker. Returns undefined whenever there's nothing real to
 * show -- no benchmark, or one measured against an old fixture set -- so
 * the picker never fabricates a number for a model that hasn't been
 * measured.
 */
import {
  BENCHMARK_FIXTURE_VERSION,
  type BenchmarkEntry,
} from '../../bench/storage.js';

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface BenchmarkBadgeInfo {
  text: string;
  stale: boolean;
}

export function formatBenchmarkBadge(
  entry: BenchmarkEntry | undefined,
  now: number = Date.now(),
): BenchmarkBadgeInfo | undefined {
  if (!entry) return undefined;
  if (entry.fixtureVersion !== BENCHMARK_FIXTURE_VERSION) return undefined;

  const measuredAtMs = Date.parse(entry.measuredAt);
  const stale =
    Number.isFinite(measuredAtMs) && now - measuredAtMs > STALE_AFTER_MS;

  return { text: `edit %${entry.scorePct} ✓`, stale };
}

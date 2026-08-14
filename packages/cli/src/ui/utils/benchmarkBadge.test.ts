/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { formatBenchmarkBadge } from './benchmarkBadge.js';
import {
  BENCHMARK_FIXTURE_VERSION,
  type BenchmarkEntry,
} from '../../bench/storage.js';

const NOW = new Date('2026-06-01T00:00:00.000Z').getTime();

function makeEntry(overrides: Partial<BenchmarkEntry> = {}): BenchmarkEntry {
  return {
    provider: 'google',
    modelId: 'gemini-2.5-pro',
    scorePct: 94,
    fixtureVersion: BENCHMARK_FIXTURE_VERSION,
    measuredAt: new Date('2026-05-25T00:00:00.000Z').toISOString(),
    fixtureResults: [],
    ...overrides,
  };
}

describe('formatBenchmarkBadge (rozet render: var/yok/eski)', () => {
  it('renders no badge when there is no entry (yok)', () => {
    expect(formatBenchmarkBadge(undefined, NOW)).toBeUndefined();
  });

  it('renders a fresh badge with the real score when measured recently (var)', () => {
    const badge = formatBenchmarkBadge(makeEntry({ scorePct: 94 }), NOW);
    expect(badge).toEqual({ text: 'edit %94 ✓', stale: false });
  });

  it('marks a badge stale once its measurement is over 30 days old (eski)', () => {
    const badge = formatBenchmarkBadge(
      makeEntry({
        measuredAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      }),
      NOW,
    );
    expect(badge?.stale).toBe(true);
  });

  it('never fabricates a number for an entry from an old, incompatible fixture set', () => {
    const badge = formatBenchmarkBadge(
      makeEntry({ fixtureVersion: 'v0-legacy' }),
      NOW,
    );
    expect(badge).toBeUndefined();
  });
});

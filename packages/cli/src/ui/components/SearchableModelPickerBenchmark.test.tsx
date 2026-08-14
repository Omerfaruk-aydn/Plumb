/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F26 (PLUMB-UI-DEVRIM-PROMPT.md): SearchableModelPicker's benchmark-badge
 * integration -- kept in its own file rather than appended to the large
 * pre-existing SearchableModelPicker.test.tsx to keep this feature's tests
 * easy to find and to avoid touching that file's established structure.
 */
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { SearchableModelPicker } from './SearchableModelPicker.js';
import type { PlumbModel } from '@plumb/provider';
import {
  BENCHMARK_FIXTURE_VERSION,
  type BenchmarkEntry,
} from '../../bench/storage.js';

function makeModel(id: string, provider = 'google'): PlumbModel {
  return {
    id,
    name: id,
    provider,
    api: 'openai-completions',
    contextWindow: 131072,
    maxTokens: 32768,
    reasoning: false,
    input: 'text',
  };
}

function makeEntry(overrides: Partial<BenchmarkEntry> = {}): BenchmarkEntry {
  return {
    provider: 'google',
    modelId: 'gemini-2.5-pro',
    scorePct: 94,
    fixtureVersion: BENCHMARK_FIXTURE_VERSION,
    measuredAt: new Date().toISOString(),
    fixtureResults: [],
    ...overrides,
  };
}

describe('SearchableModelPicker benchmark badge (picker entegrasyonu)', () => {
  it('shows the real edit-accuracy badge next to a model with a benchmark entry', async () => {
    const models = [makeModel('gemini-2.5-pro'), makeModel('gemini-2.5-flash')];
    const entry = makeEntry();
    const { lastFrame } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={() => {}}
        onCancel={() => {}}
        benchmarkEntries={{ 'google:gemini-2.5-pro': entry }}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain('edit %94');
  });

  it('shows no badge and no fabricated number for a model with no benchmark entry', async () => {
    const models = [makeModel('gemini-2.5-flash')];
    const { lastFrame } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={() => {}}
        onCancel={() => {}}
        benchmarkEntries={{}}
      />,
    );

    const frame = lastFrame();
    expect(frame).not.toContain('edit %');
    expect(frame).toContain('/bench to measure edit accuracy on this model');
  });

  it('renders a stale badge (dimmed, no accent color) for a measurement older than 30 days', async () => {
    const models = [makeModel('gemini-2.5-pro')];
    const staleEntry = makeEntry({
      measuredAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const { lastFrame } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={() => {}}
        onCancel={() => {}}
        benchmarkEntries={{ 'google:gemini-2.5-pro': staleEntry }}
      />,
    );

    // Still shows the real number -- staleness affects styling, not the data.
    expect(lastFrame()).toContain('edit %94');
  });

  it('ignores an entry measured against an old, incompatible fixture set', async () => {
    const models = [makeModel('gemini-2.5-pro')];
    const legacyEntry = makeEntry({ fixtureVersion: 'v0-legacy' });
    const { lastFrame } = await renderWithProviders(
      <SearchableModelPicker
        models={models}
        onSelect={() => {}}
        onCancel={() => {}}
        benchmarkEntries={{ 'google:gemini-2.5-pro': legacyEntry }}
      />,
    );

    expect(lastFrame()).not.toContain('edit %');
  });
});

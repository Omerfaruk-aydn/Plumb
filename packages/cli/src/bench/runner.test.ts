/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import type { Config } from '@plumb/core';
import { runBenchmark } from './runner.js';
import { BENCHMARK_FIXTURES } from './fixtures.js';

function makeConfig(generateContent: (...args: unknown[]) => unknown): Config {
  return {
    getBaseLlmClient: () => ({ generateContent }),
  } as unknown as Config;
}

describe('runBenchmark', () => {
  it('runs all 5 fixtures and averages their scores', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'irrelevant answer' }] } }],
    });
    const config = makeConfig(generateContent);
    const controller = new AbortController();

    const result = await runBenchmark({
      config,
      modelId: 'test-model',
      signal: controller.signal,
    });

    expect(generateContent).toHaveBeenCalledTimes(BENCHMARK_FIXTURES.length);
    expect(result.fixtureResults).toHaveLength(BENCHMARK_FIXTURES.length);
    expect(result.scorePct).toBeGreaterThanOrEqual(0);
    expect(result.scorePct).toBeLessThanOrEqual(100);
  });

  it('scores a fixture 0 (not a thrown error) when a single call fails, and keeps going', async () => {
    let call = 0;
    const generateContent = vi.fn().mockImplementation(() => {
      call++;
      if (call === 2) return Promise.reject(new Error('network blip'));
      return Promise.resolve({
        candidates: [{ content: { parts: [{ text: 'x' }] } }],
      });
    });
    const config = makeConfig(generateContent);
    const controller = new AbortController();

    const result = await runBenchmark({
      config,
      modelId: 'test-model',
      signal: controller.signal,
    });

    expect(result.fixtureResults).toHaveLength(BENCHMARK_FIXTURES.length);
    expect(result.fixtureResults[1].scorePct).toBe(0);
  });

  it('stops immediately and throws when cancelled before it starts (iptal)', async () => {
    const generateContent = vi.fn();
    const config = makeConfig(generateContent);
    const controller = new AbortController();
    controller.abort();

    await expect(
      runBenchmark({
        config,
        modelId: 'test-model',
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('stops mid-run once cancelled, without running the remaining fixtures (iptal yarışı)', async () => {
    const controller = new AbortController();
    let completed = 0;
    const generateContent = vi.fn().mockImplementation(async () => {
      completed++;
      if (completed === 2) controller.abort();
      return { candidates: [{ content: { parts: [{ text: 'x' }] } }] };
    });
    const config = makeConfig(generateContent);

    await expect(
      runBenchmark({
        config,
        modelId: 'test-model',
        signal: controller.signal,
      }),
    ).rejects.toThrow();

    // The 2nd call triggered the abort; a 3rd fixture must never start.
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('reports progress via onFixtureComplete as each fixture finishes', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'x' }] } }],
    });
    const config = makeConfig(generateContent);
    const controller = new AbortController();
    const progress: number[] = [];

    await runBenchmark({
      config,
      modelId: 'test-model',
      signal: controller.signal,
      onFixtureComplete: (_result, completed) => progress.push(completed),
    });

    expect(progress).toEqual([1, 2, 3, 4, 5]);
  });
});

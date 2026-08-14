/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import type { Config } from '@plumb/core';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { BenchmarkRunner } from './BenchmarkRunner.js';

const runBenchmarkMock = vi.fn();
const saveBenchmarkEntryMock = vi.fn();

vi.mock('../../bench/runner.js', () => ({
  runBenchmark: (...args: unknown[]) => runBenchmarkMock(...args),
}));
vi.mock('../../bench/storage.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../bench/storage.js')>();
  return {
    ...actual,
    saveBenchmarkEntry: (...args: unknown[]) => saveBenchmarkEntryMock(...args),
  };
});

const mockConfig = {} as Config;

describe('BenchmarkRunner', () => {
  beforeEach(() => {
    runBenchmarkMock.mockReset();
    saveBenchmarkEntryMock.mockReset().mockResolvedValue(undefined);
  });

  it('shows the final score and saves it once the run completes', async () => {
    runBenchmarkMock.mockResolvedValue({
      scorePct: 94,
      fixtureResults: [{ id: 'off-by-one', scorePct: 100 }],
    });

    const { lastFrame } = await act(async () =>
      renderWithProviders(
        <BenchmarkRunner
          config={mockConfig}
          provider="google"
          modelId="gemini-2.5-pro"
          onClose={vi.fn()}
        />,
      ),
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('edit %94');
    });
    expect(saveBenchmarkEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google',
        modelId: 'gemini-2.5-pro',
        scorePct: 94,
      }),
    );
  });

  it('shows "cancelled" and does not save anything when Esc aborts the run', async () => {
    let capturedSignal: AbortSignal | undefined;
    runBenchmarkMock.mockImplementation(
      ({ signal }: { signal: AbortSignal }) => {
        capturedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('Benchmark cancelled', 'AbortError')),
          );
        });
      },
    );

    const { lastFrame, stdin, waitUntilReady } = await act(async () =>
      renderWithProviders(
        <BenchmarkRunner
          config={mockConfig}
          provider="google"
          modelId="gemini-2.5-pro"
          onClose={vi.fn()}
        />,
      ),
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Running fixture');
    });

    await act(async () => {
      stdin.write('\x1b');
      await waitUntilReady();
    });

    await waitFor(() => {
      expect(lastFrame()).toContain('Cancelled');
    });
    expect(capturedSignal?.aborted).toBe(true);
    expect(saveBenchmarkEntryMock).not.toHaveBeenCalled();
  });
});

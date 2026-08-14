/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F26 (PLUMB-UI-DEVRIM-PROMPT.md): `/bench` progress screen -- runs the 5
 * edit fixtures against the current model, shows live progress, and writes
 * the real result to ~/.plumb/benchmarks.json on completion. Esc cancels
 * mid-run without writing anything.
 */
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Box, Text, useIsScreenReaderEnabled } from 'ink';
import type { Config } from '@plumb/core';
import { theme } from '../semantic-colors.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { runBenchmark } from '../../bench/runner.js';
import { BENCHMARK_FIXTURES } from '../../bench/fixtures.js';
import {
  saveBenchmarkEntry,
  BENCHMARK_FIXTURE_VERSION,
  type BenchmarkFixtureResult,
} from '../../bench/storage.js';

export interface BenchmarkRunnerProps {
  config: Config;
  provider: string;
  modelId: string;
  onClose: () => void;
}

type Phase =
  | { kind: 'running'; completed: number; results: BenchmarkFixtureResult[] }
  | { kind: 'done'; scorePct: number; results: BenchmarkFixtureResult[] }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export const BenchmarkRunner: React.FC<BenchmarkRunnerProps> = ({
  config,
  provider,
  modelId,
  onClose,
}) => {
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  const [phase, setPhase] = useState<Phase>({
    kind: 'running',
    completed: 0,
    results: [],
  });
  const abortControllerRef = useRef<AbortController>(new AbortController());

  useEffect(() => {
    const controller = abortControllerRef.current;

    runBenchmark({
      config,
      modelId,
      signal: controller.signal,
      onFixtureComplete: (result, completed) => {
        setPhase((prev) =>
          prev.kind === 'running'
            ? { kind: 'running', completed, results: [...prev.results, result] }
            : prev,
        );
      },
    })
      .then(async ({ scorePct, fixtureResults }) => {
        await saveBenchmarkEntry({
          provider,
          modelId,
          scorePct,
          fixtureVersion: BENCHMARK_FIXTURE_VERSION,
          measuredAt: new Date().toISOString(),
          fixtureResults,
        });
        setPhase({ kind: 'done', scorePct, results: fixtureResults });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          setPhase({ kind: 'cancelled' });
          return;
        }
        setPhase({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run exactly once per mount
  }, []);

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (phase.kind === 'running') {
          abortControllerRef.current.abort();
        } else {
          onClose();
        }
        return true;
      }
      if (phase.kind !== 'running' && key.name === 'return') {
        onClose();
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  if (isScreenReaderEnabled) {
    return (
      <Box flexDirection="column">
        <Text>
          Benchmarking {modelId} on {BENCHMARK_FIXTURES.length} edit fixtures.
        </Text>
        {phase.kind === 'running' && (
          <Text>
            {phase.completed} of {BENCHMARK_FIXTURES.length} complete.
          </Text>
        )}
        {phase.kind === 'done' && (
          <Text>Done. Edit accuracy: {phase.scorePct} percent.</Text>
        )}
        {phase.kind === 'cancelled' && <Text>Benchmark cancelled.</Text>}
        {phase.kind === 'error' && (
          <Text>Benchmark failed: {phase.message}</Text>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={theme.text.accent} bold>
        Benchmarking {modelId}
      </Text>

      {phase.kind === 'running' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            Running fixture{' '}
            {Math.min(phase.completed + 1, BENCHMARK_FIXTURES.length)} of{' '}
            {BENCHMARK_FIXTURES.length}…
          </Text>
          {phase.results.map((r) => (
            <Text key={r.id} dimColor>
              {r.id}: {r.scorePct}%
            </Text>
          ))}
          <Box marginTop={1}>
            <Text dimColor>Esc to cancel</Text>
          </Box>
        </Box>
      )}

      {phase.kind === 'done' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.status.success}>
            Done: edit %{phase.scorePct} ✓
          </Text>
          {phase.results.map((r) => (
            <Text key={r.id} dimColor>
              {r.id}: {r.scorePct}%
            </Text>
          ))}
          <Box marginTop={1}>
            <Text dimColor>Enter/Esc to close</Text>
          </Box>
        </Box>
      )}

      {phase.kind === 'cancelled' && (
        <Box marginTop={1}>
          <Text color={theme.status.warning}>
            Cancelled -- no result saved.
          </Text>
        </Box>
      )}

      {phase.kind === 'error' && (
        <Box marginTop={1}>
          <Text color={theme.status.error}>
            Benchmark failed: {phase.message}
          </Text>
        </Box>
      )}
    </Box>
  );
};

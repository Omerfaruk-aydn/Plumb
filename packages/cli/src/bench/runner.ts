/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F26 (PLUMB-UI-DEVRIM-PROMPT.md): runs the 5 BENCHMARK_FIXTURES against a
 * real model via `Config.getBaseLlmClient()` -- a stateless, one-shot
 * completion call (no chat history side effects, unlike PlumbChat), so
 * /bench doesn't pollute the user's visible conversation. Cancellable via
 * the caller's AbortSignal (Esc in the UI).
 */
import { randomUUID } from 'node:crypto';
import { LlmRole, getResponseText, type Config } from '@plumb/core';
import { BENCHMARK_FIXTURES, type BenchmarkFixture } from './fixtures.js';
import { scoreEditMatch } from './scorer.js';
import type { BenchmarkFixtureResult } from './storage.js';

export interface BenchmarkRunOptions {
  config: Config;
  modelId: string;
  signal: AbortSignal;
  onFixtureComplete?: (
    result: BenchmarkFixtureResult,
    completed: number,
    total: number,
  ) => void;
}

export interface BenchmarkRunResult {
  scorePct: number;
  fixtureResults: BenchmarkFixtureResult[];
}

function buildPrompt(fixture: BenchmarkFixture): string {
  return `${fixture.instruction}\n\n${fixture.original}`;
}

async function runFixture(
  config: Config,
  modelId: string,
  fixture: BenchmarkFixture,
  signal: AbortSignal,
): Promise<BenchmarkFixtureResult> {
  const client = config.getBaseLlmClient();
  const response = await client.generateContent({
    modelConfigKey: { model: modelId },
    contents: [{ role: 'user', parts: [{ text: buildPrompt(fixture) }] }],
    abortSignal: signal,
    promptId: `bench-${fixture.id}-${randomUUID().slice(0, 8)}`,
    role: LlmRole.UTILITY_TOOL,
    maxAttempts: 1,
  });

  const text = getResponseText(response) ?? '';
  return { id: fixture.id, scorePct: scoreEditMatch(fixture.expected, text) };
}

export async function runBenchmark(
  options: BenchmarkRunOptions,
): Promise<BenchmarkRunResult> {
  const { config, modelId, signal, onFixtureComplete } = options;
  const fixtureResults: BenchmarkFixtureResult[] = [];

  for (let i = 0; i < BENCHMARK_FIXTURES.length; i++) {
    if (signal.aborted) {
      throw new DOMException('Benchmark cancelled', 'AbortError');
    }

    const fixture = BENCHMARK_FIXTURES[i];
    let result: BenchmarkFixtureResult;
    try {
      result = await runFixture(config, modelId, fixture, signal);
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      // A single fixture failing (network error, malformed response, etc.)
      // shouldn't abort the whole run -- score it 0 and continue, same as
      // a completely wrong edit would score.
      result = { id: fixture.id, scorePct: 0 };
    }

    fixtureResults.push(result);
    onFixtureComplete?.(result, i + 1, BENCHMARK_FIXTURES.length);
  }

  const scorePct = Math.round(
    fixtureResults.reduce((sum, r) => sum + r.scorePct, 0) /
      fixtureResults.length,
  );

  return { scorePct, fixtureResults };
}

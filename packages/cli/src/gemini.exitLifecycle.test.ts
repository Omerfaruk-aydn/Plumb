/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');
const harnessPath = path.join(
  __dirname,
  'lifecycle/uvHandleClosingRepro.harness.mjs',
);
const providerDist = path.join(repoRoot, 'packages/provider/dist/index.js');
const cliDist = path.join(repoRoot, 'packages/cli/dist/src/toolRouteProbe.js');

const distAvailable = existsSync(providerDist) && existsSync(cliDist);

interface HarnessProbeResult {
  label: string;
  code: string;
  exitCode: number;
  before: number;
  after: number;
}

interface HarnessRun {
  stdout: string;
  stderr: string;
  exitCode: number;
  results: HarnessProbeResult[] | undefined;
}

async function runHarness(args: string[] = []): Promise<HarnessRun> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [harnessPath, ...args],
      { timeout: 60_000 },
    );
    const match = /HARNESS_RESULT_JSON:(.*)/.exec(stdout);
    return {
      stdout,
      stderr,
      exitCode: 0,
      results: match ? JSON.parse(match[1]).results : undefined,
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    const match = /HARNESS_RESULT_JSON:(.*)/.exec(e.stdout ?? '');
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.code ?? 1,
      results: match ? JSON.parse(match[1]).results : undefined,
    };
  }
}

// Skipped (not failed) when packages/provider or packages/cli dist isn't
// built -- this suite drives the real compiled lifecycle, so it has
// nothing to run against without a prior `npm run build`.
describe.skipIf(!distAvailable)(
  'Windows UV_HANDLE_CLOSING regression (real production lifecycle, child-process isolated)',
  () => {
    it('sequential probes A(success) -> B(HTTP 400, zero tool calls) -> C(success) in ONE process never crash, never leave a dangling ownership error', async () => {
      const run = await runHarness([]);
      expect(run.stderr).not.toMatch(/Assertion failed/i);
      expect(run.stderr).not.toMatch(/UV_HANDLE_CLOSING/i);
      expect(run.exitCode).toBe(0);
      expect(run.results).toBeDefined();
      expect(run.results!.map((r) => r.label)).toEqual(['A', 'B', 'C']);
      expect(run.results!.find((r) => r.label === 'A')?.code).toBe('OK');
      expect(run.results!.find((r) => r.label === 'B')?.code).toBe(
        'INVALID_REQUEST',
      );
      expect(run.results!.find((r) => r.label === 'C')?.code).toBe('OK');
    }, 30_000);

    it('the SAME sequence in REVERSE order (C -> B -> A) also never crashes — proves the fix is ordering-independent', async () => {
      const run = await runHarness(['reverse']);
      expect(run.stderr).not.toMatch(/Assertion failed/i);
      expect(run.stderr).not.toMatch(/UV_HANDLE_CLOSING/i);
      expect(run.exitCode).toBe(0);
      expect(run.results!.map((r) => r.label)).toEqual(['C', 'B', 'A']);
    }, 30_000);

    it('repeated runs (5x) never intermittently crash — the original bug reproduced "not consistently", so a single clean run is not sufficient proof', async () => {
      for (let i = 0; i < 5; i++) {
        const run = await runHarness([]);
        expect(run.stderr).not.toMatch(/Assertion failed/i);
        expect(run.exitCode).toBe(0);
      }
    }, 120_000);

    it('active handle count does not grow unboundedly across sequential probes (no leaked per-probe resource)', async () => {
      const run = await runHarness([]);
      expect(run.results).toBeDefined();
      // Each probe issues 1-2 real HTTP round-trips; some handle growth
      // from keep-alive connection pooling across DIFFERENT origins is
      // expected and not itself a bug (Node/undici manage those, and they
      // do not block natural process exit -- proven by exitCode:0 above).
      // The invariant under test is boundedness, not zero growth.
      const counts = run.results!.map((r) => r.after - r.before);
      for (const delta of counts) {
        expect(delta).toBeLessThanOrEqual(3);
      }
    }, 30_000);
  },
);

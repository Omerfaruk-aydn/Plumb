/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

/**
 * Windows ConPTY acceptance test for `plumb --test-provider github-copilot`.
 *
 * Proves on a real ConPTY that:
 *  1. the built CLI starts and stays running;
 *  2. startup output is received BEFORE any input is sent;
 *  3. the verification URL and a redacted-code marker arrive before cancel;
 *  4. at least one heartbeat line is received;
 *  5. Ctrl+C produces Cancelling... / LIVE_TEST_CANCELLED;
 *  6. nothing arrives after the final result;
 *  7. the process exits;
 *  8. the terminal is restored (raw mode released, report says so).
 *
 * The harness runs with PLUMB_ACCEPTANCE_STUB=1, a deterministic provider
 * boundary that never touches the network.
 *
 * Under the previous implementation (output buffered until cleanup) this test
 * fails at step 2 because nothing arrives before input/cancellation.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as pty from '@lydell/node-pty';

const isWindows = process.platform === 'win32';
const cliRoot = path.resolve(__dirname, '../..');
const distIndex = path.join(cliRoot, 'dist', 'index.js');

const describeConpty =
  isWindows && existsSync(distIndex) ? describe : describe.skip;

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 200,
  onTimeout?: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `waitFor timed out after ${timeoutMs}ms${onTimeout ? `: ${onTimeout()}` : ''}`,
  );
}

describeConpty('provider acceptance Windows ConPTY output', () => {
  it('streams startup output before input and cancels cleanly', async () => {
    const env: Record<string, string> = {};
    const critical = [
      'SystemRoot',
      'COMSPEC',
      'windir',
      'PATHEXT',
      'TEMP',
      'TMP',
      'PATH',
    ];
    for (const key of critical) {
      const value = process.env[key];
      if (value) env[key] = value;
    }
    env['GEMINI_CLI_NO_RELAUNCH'] = '1';
    env['PLUMB_ACCEPTANCE_STUB'] = '1';

    const ptyProcess = pty.spawn(
      process.execPath,
      [distIndex, '--test-provider', 'github-copilot'],
      {
        name: 'xterm-color',
        cols: 100,
        rows: 40,
        cwd: cliRoot,
        env,
      },
    );

    let output = '';
    let exited: number | undefined;
    ptyProcess.onData((data: string) => {
      output += data;
    });
    ptyProcess.onExit((e: { exitCode: number }) => {
      exited = e.exitCode;
    });

    try {
      // 1 + 2: startup output must arrive before ANY input is sent.
      await waitFor(
        () => output.includes('PLUMB coding-plan live acceptance'),
        240000,
        250,
        () => output.slice(-4000),
      );
      await waitFor(
        () => output.includes('Stage: Requesting device authorization...'),
        60000,
        250,
        () => output.slice(-4000),
      );

      // 3: URL and redacted code marker before cancellation.
      await waitFor(
        () => output.includes('https://github.com/login/device'),
        60000,
        250,
        () => output.slice(-4000),
      );
      await waitFor(
        () => output.includes('PLUMB-STUB-0000'),
        60000,
        250,
        () => output.slice(-4000),
      );

      // The process must still be running before we send anything.
      expect(exited).toBeUndefined();

      // 4: at least one heartbeat while polling.
      await waitFor(
        () => /Waiting for GitHub authorization\.\.\. \d+s/.test(output),
        90000,
        300,
        () => output.slice(-4000),
      );

      // 5: cancel.
      ptyProcess.write('\x03');
      await waitFor(
        () => output.includes('Cancelling...'),
        60000,
        250,
        () => output.slice(-4000),
      );
      await waitFor(
        () => output.includes('LIVE_TEST_CANCELLED'),
        60000,
        250,
        () => output.slice(-4000),
      );
      await waitFor(
        () => output.includes('result: LIVE_TEST_CANCELLED'),
        60000,
        250,
        () => output.slice(-4000),
      );
      await waitFor(
        () => output.includes('terminal.restored: true'),
        60000,
        250,
        () => output.slice(-4000),
      );

      // 6: nothing may arrive after the final result.
      const tailStart = output.length;
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const tail = output.slice(tailStart);
      expect(tail).not.toMatch(/Waiting for GitHub authorization/);
      expect(tail).not.toContain('LIVE_TEST_CANCELLED');
      expect(tail).not.toContain('trace.stage:');

      // 7: the process exits.
      await waitFor(() => exited !== undefined, 60000, 300);
      expect(exited).toBe(1);

      // Never leak anything that looks like a credential.
      expect(output).not.toMatch(/access[_-]?key/i);
      expect(output).not.toContain('PLUMB_STUB_KEY');
    } finally {
      try {
        ptyProcess.kill();
      } catch {
        // already gone
      }
    }
  }, 400000);

  it('auto-auths, selects a model, and ends with LIVE_VERIFIED', async () => {
    const env: Record<string, string> = {};
    const critical = [
      'SystemRoot',
      'COMSPEC',
      'windir',
      'PATHEXT',
      'TEMP',
      'TMP',
      'PATH',
    ];
    for (const key of critical) {
      const value = process.env[key];
      if (value) env[key] = value;
    }
    env['GEMINI_CLI_NO_RELAUNCH'] = '1';
    env['PLUMB_ACCEPTANCE_STUB'] = '1';
    env['PLUMB_ACCEPTANCE_STUB_AUTO'] = '1';

    const ptyProcess = pty.spawn(
      process.execPath,
      [distIndex, '--test-provider', 'github-copilot'],
      {
        name: 'xterm-color',
        cols: 100,
        rows: 40,
        cwd: cliRoot,
        env,
      },
    );

    let output = '';
    let exited: number | undefined;
    ptyProcess.onData((data: string) => {
      output += data;
    });
    ptyProcess.onExit((e: { exitCode: number }) => {
      exited = e.exitCode;
    });

    try {
      await waitFor(
        () => output.includes('PLUMB coding-plan live acceptance'),
        240000,
        250,
        () => output.slice(-4000),
      );
      await waitFor(
        () => output.includes('PLUMB-STUB-0000'),
        60000,
        250,
        () => output.slice(-4000),
      );

      // Auto-auth: typing the stub code resolves the credential.
      ptyProcess.write('PLUMB-STUB-0000\n');
      await waitFor(
        () => output.includes('Authentication successful.'),
        60000,
        250,
        () => output.slice(-4000),
      );
      await waitFor(
        () => /Models loaded: \d+/.test(output),
        60000,
        250,
        () => output.slice(-4000),
      );
      await waitFor(
        () => /Enter model number \[1-\d+\]/.test(output),
        60000,
        250,
        () => output.slice(-4000),
      );

      // The first model from the real bundled catalog must be selectable.
      const firstMatch = output.match(/^\s*1\.\s+(\S+)/m);
      expect(firstMatch).not.toBeNull();
      const firstModelId = firstMatch![1];
      expect(firstModelId).not.toContain('PLUMB_STUB');

      expect(exited).toBeUndefined();
      // The picker runs canonical mode on Windows: a line is only delivered
      // once CR arrives, so write '\r' (not '\n') to submit the choice.
      ptyProcess.write('1\r');

      await waitFor(
        () => output.includes(`Selected model: ${firstModelId}`),
        60000,
        250,
        () => output.slice(-16000),
      );
      await waitFor(
        () => output.includes('result: LIVE_VERIFIED'),
        60000,
        250,
        () => output.slice(-4000),
      );
      await waitFor(
        () => output.includes('stream.completed: true'),
        60000,
        250,
        () => output.slice(-4000),
      );
      await waitFor(
        () => output.includes('terminal.restored: true'),
        60000,
        250,
        () => output.slice(-4000),
      );

      // Nothing may arrive after the final result and the process exits 0.
      const tailStart = output.length;
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const tail = output.slice(tailStart);
      expect(tail).not.toMatch(/trace\.stage:/);
      expect(tail).not.toContain('Waiting for GitHub authorization');

      await waitFor(() => exited !== undefined, 60000, 300);
      expect(exited).toBe(0);

      expect(output).not.toMatch(/access[_-]?key/i);
      expect(output).not.toContain('PLUMB_STUB_KEY');
    } finally {
      try {
        ptyProcess.kill();
      } catch {
        // already gone
      }
    }
  }, 500000);

  it('cancels cleanly while the model picker is waiting', async () => {
    const env: Record<string, string> = {};
    for (const key of [
      'SystemRoot',
      'COMSPEC',
      'windir',
      'PATHEXT',
      'TEMP',
      'TMP',
      'PATH',
    ]) {
      const value = process.env[key];
      if (value) env[key] = value;
    }
    env['GEMINI_CLI_NO_RELAUNCH'] = '1';
    env['PLUMB_ACCEPTANCE_STUB'] = '1';
    env['PLUMB_ACCEPTANCE_STUB_AUTO'] = '1';

    const ptyProcess = pty.spawn(
      process.execPath,
      [distIndex, '--test-provider', 'github-copilot'],
      {
        name: 'xterm-color',
        cols: 100,
        rows: 40,
        cwd: cliRoot,
        env,
      },
    );

    let output = '';
    let exited: number | undefined;
    ptyProcess.onData((data: string) => {
      output += data;
    });
    ptyProcess.onExit((e: { exitCode: number }) => {
      exited = e.exitCode;
    });

    try {
      await waitFor(
        () => output.includes('PLUMB coding-plan live acceptance'),
        300000,
        250,
        () => output.slice(-4000),
      );
      await waitFor(
        () => output.includes('PLUMB-STUB-0000'),
        60000,
        250,
        () => output.slice(-4000),
      );
      ptyProcess.write('PLUMB-STUB-0000\n');
      await waitFor(
        () => /Enter model number \[1-\d+\]/.test(output),
        90000,
        250,
        () => output.slice(-4000),
      );

      // Ctrl+C while the picker is open must cancel gracefully.
      expect(exited).toBeUndefined();
      ptyProcess.write('\x03');
      await waitFor(
        () => output.includes('Cancelling...'),
        60000,
        250,
        () => output.slice(-4000),
      );
      await waitFor(
        () => output.includes('result: LIVE_TEST_CANCELLED'),
        60000,
        250,
        () => output.slice(-4000),
      );
      await waitFor(
        () => output.includes('terminal.restored: true'),
        60000,
        250,
        () => output.slice(-4000),
      );
      await waitFor(() => exited !== undefined, 60000, 300);
      expect(exited).toBe(1);

      expect(output).not.toMatch(/access[_-]?key/i);
    } finally {
      try {
        ptyProcess.kill();
      } catch {
        // already gone
      }
    }
  }, 500000);
});

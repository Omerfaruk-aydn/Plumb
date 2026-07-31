/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Runtime identity contract for the production CLI route:
 *   node packages/cli/dist/index.js  ==  global plumb
 *
 * Covers: direct dist identity, global linked identity, entry SHA equality,
 * embedded-HEAD vs repository-HEAD equality, and rejection of a stale
 * embedded HEAD (the linked global command must fail --runtime-identity
 * when the embedded HEAD does not equal the source HEAD).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

interface ProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Async spawn that keeps the vitest worker event loop responsive. */
function runProcess(
  argv: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: options.cwd ?? ROOT,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`process timed out: ${argv.join(' ')}`));
    }, options.timeoutMs ?? 150_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });
  });
}

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TEST_DIR, '..', '..');
const CLI_DIST = path.join(ROOT, 'packages', 'cli', 'dist');
const DIST_ENTRY = path.join(CLI_DIST, 'index.js');
const EMBEDDED_IDENTITY = path.join(
  CLI_DIST,
  'src',
  'generated',
  'buildIdentity.js',
);
const IS_WINDOWS = process.platform === 'win32';

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function gitHead(): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf-8',
    shell: false,
  });
  expect(result.status).toBe(0);
  return result.stdout.trim().toLowerCase();
}

function npmRootGlobal(): string {
  const npmCli = process.env['npm_execpath'];
  const argv = npmCli
    ? [process.execPath, npmCli, 'root', '-g']
    : ['npm', 'root', '-g'];
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: 'utf-8',
    shell: false,
  });
  expect(result.status).toBe(0);
  return result.stdout.trim().split(/\r?\n/).pop()!.trim();
}

function globalPlumbShim(): string {
  const shim = path.join(
    path.dirname(npmRootGlobal()),
    IS_WINDOWS ? 'plumb.cmd' : 'plumb',
  );
  expect(fs.existsSync(shim), `global plumb shim missing: ${shim}`).toBe(true);
  return shim;
}

function runGlobalPlumb(flag: string): Promise<ProcessResult> {
  const shim = globalPlumbShim();
  const argv = IS_WINDOWS
    ? ['cmd.exe', '/d', '/s', '/c', shim, flag]
    : [shim, flag];
  return runProcess(argv, { timeoutMs: 150_000 });
}

function runDirectDist(flag: string): Promise<ProcessResult> {
  return runProcess([process.execPath, DIST_ENTRY, flag], {
    timeoutMs: 150_000,
  });
}

describe('plumb production runtime identity', () => {
  it('runs --runtime-identity on the direct local dist entry', { timeout: 180_000 }, async () => {
    expect(fs.existsSync(DIST_ENTRY), 'dist entry missing — run npm run link:plumb first').toBe(true);
    const result = await runDirectDist('--runtime-identity');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PLUMB runtime identity');
    expect(result.stdout).toContain('product.name: PLUMB');
    expect(result.stdout).toContain('package.name: plumb-cli');
    expect(result.stdout).toContain('freshness: current');
    expect(result.stdout).not.toContain('Usage: gemini');
    expect(result.stderr).not.toContain('Unknown argument');
  });

  it('runs --diagnose-logo on the direct local dist entry', { timeout: 180_000 }, async () => {
    const result = await runDirectDist('--diagnose-logo');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PLUMB logo diagnostics');
    expect(result.stdout).toContain('rendering.mode:');
    expect(result.stdout).toContain('component.wordmark.dist:');
    expect(result.stdout).not.toContain('Usage: gemini');
  });

  it('runs --runtime-identity on the global linked plumb command', { timeout: 180_000 }, async () => {
    const result = await runGlobalPlumb('--runtime-identity');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PLUMB runtime identity');
    expect(result.stdout).not.toContain('Usage: gemini');
  });

  it('runs --diagnose-logo on the global linked plumb command', { timeout: 180_000 }, async () => {
    const result = await runGlobalPlumb('--diagnose-logo');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PLUMB logo diagnostics');
    expect(result.stdout).not.toContain('Usage: gemini');
  });

  it('keeps the direct and global entry byte-identical', { timeout: 180_000 }, () => {
    const globalEntry = path.join(
      npmRootGlobal(),
      'plumb-cli',
      'dist',
      'index.js',
    );
    expect(fs.existsSync(globalEntry), `global entry missing: ${globalEntry}`).toBe(true);
    expect(sha256File(fs.realpathSync(globalEntry))).toBe(
      sha256File(fs.realpathSync(DIST_ENTRY)),
    );
  });

  it('embeds the current repository HEAD in the built identity', { timeout: 180_000 }, () => {
    const content = fs.readFileSync(EMBEDDED_IDENTITY, 'utf-8');
    const match = content.match(/gitHead:\s*'([0-9a-f]{40})'/);
    expect(match, 'embedded identity lacks a full Git HEAD').not.toBeNull();
    expect(match![1]).toBe(gitHead());
  });

  it('reports the embedded HEAD through the global command', { timeout: 180_000 }, async () => {
    const result = await runGlobalPlumb('--runtime-identity');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`build.embeddedHead: ${gitHead()}`);
  });
});

describe('stale embedded HEAD rejection', () => {
  let originalIdentity: string | null = null;

  afterEach(() => {
    if (originalIdentity !== null && fs.existsSync(EMBEDDED_IDENTITY)) {
      fs.writeFileSync(EMBEDDED_IDENTITY, originalIdentity);
      originalIdentity = null;
    }
  });

  it('fails --runtime-identity when the embedded HEAD differs from the source HEAD', { timeout: 180_000 }, async () => {
    expect(fs.existsSync(EMBEDDED_IDENTITY)).toBe(true);
    originalIdentity = fs.readFileSync(EMBEDDED_IDENTITY, 'utf-8');

    const staleHead = '0'.repeat(40);
    expect(staleHead).not.toBe(gitHead());
    const tampered = originalIdentity.replace(
      /gitHead:\s*'[0-9a-f]{40}'/,
      `gitHead: '${staleHead}'`,
    );
    expect(tampered).not.toBe(originalIdentity);
    fs.writeFileSync(EMBEDDED_IDENTITY, tampered);

    try {
      const result = await runDirectDist('--runtime-identity');
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('freshness: STALE');
      expect(result.stderr).toContain('STALE');
      expect(result.stderr).toContain(staleHead);
    } finally {
      fs.writeFileSync(EMBEDDED_IDENTITY, originalIdentity);
      originalIdentity = null;
    }
  });
});

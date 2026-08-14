/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env['PLUMB_LINK_NO_AUTOMAIN'] = '1';
const linkPlumb = await import('../link-plumb.mjs');

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TEST_DIR, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'link-plumb.mjs');
const TMP_DIR = path.join(ROOT, 'scripts', 'tests', '.tmp');

/** Commands used as step overrides: no whitespace inside, shell-free. */
const CMD_OK = 'node -e process.exit(0)';
const CMD_FAIL = 'node -e process.exit(3)';

interface LinkRun {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

function childEnv(extraEnv: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // The test harness sets PLUMB_LINK_NO_AUTOMAIN for its own import of the
  // module; spawned children must run main().
  delete env['PLUMB_LINK_NO_AUTOMAIN'];
  return {
    ...env,
    PLUMB_LINK_ALLOW_DIRTY: '1',
    // Prove the route never depends on a command shell.
    COMSPEC: 'C:\\nonexistent\\cmd.exe',
    SHELL: '/nonexistent/sh',
    ...extraEnv,
  };
}

function runLinkScript(extraEnv: Record<string, string>): LinkRun {
  // Spawn the exact command the package.json script declares. Running the
  // Node entry directly (instead of through npm's shell-based lifecycle
  // spawner) is what makes the route shell-independent end to end.
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf-8',
    shell: false,
    env: childEnv(extraEnv),
    timeout: 300_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

function markerPath(name: string): string {
  return path
    .join(TMP_DIR, `${name}-${process.pid}-${Date.now()}.marker`)
    .replaceAll('\\', '/');
}

function markCommand(marker: string): string {
  return `node -e require('fs').appendFileSync('${marker}','called')`;
}

function globalPlumbShim(): string | null {
  const result = spawnSync(
    process.execPath,
    [linkPlumb.resolveNpmCli(), 'root', '-g'],
    { encoding: 'utf-8', shell: false },
  );
  if (result.status !== 0) return null;
  const globalRoot = result.stdout.trim().split(/\r?\n/).pop()!.trim();
  const shim = path.join(
    path.dirname(globalRoot),
    process.platform === 'win32' ? 'plumb.cmd' : 'plumb',
  );
  return fs.existsSync(shim) ? shim : null;
}

function sha256File(file: string): string | null {
  try {
    return linkPlumb.sha256File(file);
  } catch {
    return null;
  }
}

beforeAll(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('link-plumb atomic failure route', () => {
  it('stops after a provider build failure without calling npm link', () => {
    const unlinkMarker = markerPath('unlink');
    const linkMarker = markerPath('link');
    const shim = globalPlumbShim();
    const shimBefore = shim ? sha256File(shim) : null;

    const run = runLinkScript({
      PLUMB_LINK_CMD_BUILDPROVIDER: CMD_FAIL,
      PLUMB_LINK_CMD_UNLINKSTALE: markCommand(unlinkMarker),
      PLUMB_LINK_CMD_LINKWORKSPACE: markCommand(linkMarker),
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('FAILED at step buildProvider');
    expect(fs.existsSync(unlinkMarker)).toBe(false);
    expect(fs.existsSync(linkMarker)).toBe(false);
    if (shim && shimBefore) {
      expect(sha256File(shim)).toBe(shimBefore);
    }
  }, 120_000);

  it('stops after a core build failure without calling npm link', () => {
    const linkMarker = markerPath('link');
    const run = runLinkScript({
      PLUMB_LINK_CMD_BUILDPROVIDER: CMD_OK,
      PLUMB_LINK_CMD_BUILDCORE: CMD_FAIL,
      PLUMB_LINK_CMD_UNLINKSTALE: markCommand(markerPath('unlink')),
      PLUMB_LINK_CMD_LINKWORKSPACE: markCommand(linkMarker),
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('FAILED at step buildCore');
    expect(fs.existsSync(linkMarker)).toBe(false);
  }, 120_000);

  it('stops after a CLI build failure without calling npm link', () => {
    // The pre-build dist wipe must not touch the real production dist.
    const scratchDist = fs.mkdtempSync(
      path.join(os.tmpdir(), 'plumb-buildfail-dist-'),
    );
    try {
      const linkMarker = markerPath('link');
      const run = runLinkScript({
        PLUMB_LINK_CMD_BUILDPROVIDER: CMD_OK,
        PLUMB_LINK_CMD_BUILDCORE: CMD_OK,
        PLUMB_LINK_CMD_TYPECHECKCLI: CMD_OK,
        PLUMB_LINK_CMD_BUILDCLIIDENTITY: CMD_OK,
        PLUMB_LINK_CMD_BUILDCLI: CMD_FAIL,
        PLUMB_LINK_DIST_DIR: scratchDist,
        PLUMB_LINK_CMD_UNLINKSTALE: markCommand(markerPath('unlink')),
        PLUMB_LINK_CMD_LINKWORKSPACE: markCommand(linkMarker),
      });

      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain('FAILED at step buildCli');
      expect(fs.existsSync(linkMarker)).toBe(false);
    } finally {
      fs.rmSync(scratchDist, { recursive: true, force: true });
    }
  }, 120_000);

  it('rejects a dist that lacks the diagnostic flags even when the build succeeds', () => {
    const fakeDist = fs.mkdtempSync(
      path.join(os.tmpdir(), 'plumb-stale-dist-'),
    );
    try {
      // A syntactically valid but diagnostic-free dist entry, as produced by
      // the retired build route (no --runtime-identity / --diagnose-logo).
      fs.writeFileSync(
        path.join(fakeDist, 'index.js'),
        'console.log("gemini");\n',
      );

      const linkMarker = markerPath('link');
      const run = runLinkScript({
        PLUMB_LINK_CMD_BUILDPROVIDER: CMD_OK,
        PLUMB_LINK_CMD_BUILDCORE: CMD_OK,
        PLUMB_LINK_CMD_TYPECHECKCLI: CMD_OK,
        PLUMB_LINK_CMD_BUILDCLIIDENTITY: CMD_OK,
        PLUMB_LINK_CMD_BUILDCLI: CMD_OK,
        PLUMB_LINK_DIST_DIR: fakeDist,
        PLUMB_LINK_CMD_UNLINKSTALE: markCommand(markerPath('unlink')),
        PLUMB_LINK_CMD_LINKWORKSPACE: markCommand(linkMarker),
      });

      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain('FAILED at step verifyDist');
      expect(fs.existsSync(linkMarker)).toBe(false);
    } finally {
      fs.rmSync(fakeDist, { recursive: true, force: true });
    }
  }, 120_000);

  it('resolves its command plan without any command shell', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--plan'], {
      cwd: ROOT,
      encoding: 'utf-8',
      shell: false,
      env: childEnv({}),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('command plan');
    expect(result.stdout).toContain('no shell builtins involved');
  });

  it('is wired as the package.json link:plumb script', () => {
    const npmCli = linkPlumb.resolveNpmCli();
    const result = spawnSync(
      process.execPath,
      [npmCli, 'run', 'link:plumb', '--silent', '--', '--plan'],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        shell: false,
        env: childEnv({
          // npm's own lifecycle spawner needs a real shell on Windows.
          COMSPEC: process.env['COMSPEC'] ?? 'C:\\Windows\\System32\\cmd.exe',
        }),
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('command plan');
  });
});

describe('verifyDistDiagnostics', () => {
  it('accepts the current production dist with the diagnostic route', () => {
    const problems = linkPlumb.verifyDistDiagnostics(
      path.join(ROOT, 'packages', 'cli', 'dist'),
      path.join(ROOT, 'packages', 'core', 'dist'),
      path.join(ROOT, 'packages', 'provider', 'dist'),
    );
    expect(problems).toEqual([]);
  });

  it('rejects a dist tree missing the diagnostic handler modules', () => {
    const fakeDist = fs.mkdtempSync(
      path.join(os.tmpdir(), 'plumb-verify-dist-'),
    );
    try {
      fs.writeFileSync(path.join(fakeDist, 'index.js'), '// entry\n');
      const problems = linkPlumb.verifyDistDiagnostics(
        fakeDist,
        path.join(ROOT, 'packages', 'core', 'dist'),
        path.join(ROOT, 'packages', 'provider', 'dist'),
      );
      const joined = problems.join('\n');
      expect(joined).toContain('parser module missing');
      expect(joined).toContain('diagnostics handler module missing');
      expect(joined).toContain('embedded build identity module missing');
      expect(joined).toContain('animated wordmark module missing');
    } finally {
      fs.rmSync(fakeDist, { recursive: true, force: true });
    }
  });

  it('rejects a parser module that does not register the flags', () => {
    const fakeDist = fs.mkdtempSync(
      path.join(os.tmpdir(), 'plumb-verify-flags-'),
    );
    try {
      fs.writeFileSync(path.join(fakeDist, 'index.js'), '// entry\n');
      fs.mkdirSync(path.join(fakeDist, 'src', 'config'), { recursive: true });
      fs.writeFileSync(
        path.join(fakeDist, 'src', 'config', 'config.js'),
        '// parser without diagnostics\n',
      );
      const problems = linkPlumb.verifyDistDiagnostics(
        fakeDist,
        path.join(ROOT, 'packages', 'core', 'dist'),
        path.join(ROOT, 'packages', 'provider', 'dist'),
      );
      const joined = problems.join('\n');
      expect(joined).toContain('--runtime-identity');
      expect(joined).toContain('--diagnose-logo');
    } finally {
      fs.rmSync(fakeDist, { recursive: true, force: true });
    }
  });
});

describe('entriesIdentical', () => {
  it('accepts identical entries and rejects diverging ones', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plumb-entry-'));
    try {
      const a = path.join(dir, 'a.js');
      const b = path.join(dir, 'b.js');
      const c = path.join(dir, 'c.js');
      fs.writeFileSync(a, 'identical entry\n');
      fs.writeFileSync(b, 'identical entry\n');
      fs.writeFileSync(c, 'stale entry\n');

      expect(linkPlumb.entriesIdentical(a, b)).toBe(true);
      expect(linkPlumb.entriesIdentical(a, c)).toBe(false);
      expect(linkPlumb.entriesIdentical(a, path.join(dir, 'missing.js'))).toBe(
        false,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

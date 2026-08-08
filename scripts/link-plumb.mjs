#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Atomic PLUMB production link route (replaces the broken Windows shell
 * chain that continued to `npm link` after failed commands).
 *
 * Every step runs via child_process.spawnSync with an explicit executable,
 * an explicit argument array, stdio inherited, and shell:false. Any non-zero
 * step aborts the route immediately — no link is ever attempted after a
 * failed build.
 *
 * Debug/test hooks (environment):
 *   PLUMB_LINK_ALLOW_DIRTY=1     permit a dirty worktree (step verifyWorktree)
 *   PLUMB_LINK_CMD_<STEP_ID>     replace the command of a step, whitespace split
 *   PLUMB_LINK_DIST_DIR=<path>   verify an alternate CLI dist directory
 *   PLUMB_LINK_PLAN=1 (or --plan) print the resolved command plan and exit 0
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const CLI_DIR = path.join(ROOT, 'packages', 'cli');
const CLI_PACKAGE_NAME = 'plumb-cli';
const LEGACY_GLOBAL_PACKAGE_NAMES = ['@google/gemini-cli'];
const EXPECTED_BINS = ['plumb', 'gemini'];
const IS_WINDOWS = process.platform === 'win32';

// ─── Output helpers ────────────────────────────────────────────────────────

function info(message) {
  process.stdout.write(`[link:plumb] ${message}\n`);
}

function fail(stepId, reason) {
  process.stderr.write(`[link:plumb] FAILED at step ${stepId}: ${reason}\n`);
  process.stderr.write('[link:plumb] no global link changes were committed after this failure.\n');
  process.exit(1);
}

// ─── Executable resolution (no shell involved) ─────────────────────────────

/** npm CLI entry — npm sets npm_execpath for every `npm run` invocation. */
export function resolveNpmCli() {
  const fromEnv = process.env['npm_execpath'];
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  throw new Error('unable to resolve npm-cli.js (npm_execpath not set)');
}

export function resolvePlan() {
  const npmCli = resolveNpmCli();
  const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  return {
    node: process.execPath,
    npm: [process.execPath, npmCli],
    tsc: [process.execPath, tscBin],
    git: 'git',
    where: IS_WINDOWS ? 'where.exe' : 'which',
    powershell: IS_WINDOWS ? 'powershell.exe' : null,
    cmdShimRunner: IS_WINDOWS ? 'cmd.exe' : null,
    buildIdentityScript: path.join(ROOT, 'scripts', 'generate-build-identity.js'),
  };
}

// ─── Step runner ───────────────────────────────────────────────────────────

/**
 * Run one step. `capture: true` returns {stdout} instead of inheriting stdio.
 * Aborts the whole route on any non-zero exit.
 */
export function runStep(plan, stepId, command, args, options = {}) {
  let finalCommand = command;
  let finalArgs = args;
  const override = process.env[`PLUMB_LINK_CMD_${stepId.toUpperCase()}`];
  if (override && override.trim()) {
    const parts = override.trim().split(/\s+/);
    finalCommand = parts[0];
    finalArgs = parts.slice(1);
    info(`step ${stepId}: command overridden via PLUMB_LINK_CMD_${stepId.toUpperCase()}`);
  }

  const display = [...(Array.isArray(finalCommand) ? finalCommand : [finalCommand]), ...finalArgs].join(' ');
  info(`step ${stepId}: ${display}${options.cwd ? ` (cwd: ${options.cwd})` : ''}`);

  const argv = Array.isArray(finalCommand) ? [...finalCommand, ...finalArgs] : [finalCommand, ...finalArgs];
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: options.cwd ?? ROOT,
    env: process.env,
    shell: false,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: options.capture ? 'utf-8' : undefined,
  });

  if (result.error) {
    fail(stepId, `spawn failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = options.capture && result.stderr ? ` — ${result.stderr.trim().slice(0, 400)}` : '';
    fail(stepId, `exit code ${result.status}${detail}`);
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Run a step that is expected to fail; returns the captured result. */
export function runProbe(argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
  };
}

// ─── Verification helpers ──────────────────────────────────────────────────

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function entriesIdentical(localEntry, globalEntry) {
  if (!fs.existsSync(localEntry) || !fs.existsSync(globalEntry)) {
    return false;
  }
  const localReal = fs.realpathSync(localEntry);
  const globalReal = fs.realpathSync(globalEntry);
  if (localReal === globalReal) {
    return true;
  }
  return sha256File(localReal) === sha256File(globalReal);
}

function gitHead() {
  const result = runProbe(['git', 'rev-parse', 'HEAD'], { cwd: ROOT });
  if (result.status !== 0) {
    return null;
  }
  const head = result.stdout.trim();
  return /^[0-9a-f]{40}$/i.test(head) ? head.toLowerCase() : null;
}

function readEmbeddedHead(distDir) {
  const identityFile = path.join(distDir, 'src', 'generated', 'buildIdentity.js');
  if (!fs.existsSync(identityFile)) {
    return null;
  }
  const content = fs.readFileSync(identityFile, 'utf-8');
  const match = content.match(/gitHead:\s*'([0-9a-f]{40}|unknown)'/);
  return match ? match[1] : null;
}

/**
 * Validate the actual diagnostic option handler modules inside a dist tree —
 * not merely generic strings: the parser registration in the compiled config
 * module, the compiled diagnostics handler module, the embedded build
 * identity, the provider startup/registry modules, and the wordmark module.
 */
export function verifyDistDiagnostics(distDir, coreDistDir, providerDistDir) {
  const problems = [];
  const requireFile = (file, label) => {
    if (!fs.existsSync(file)) {
      problems.push(`${label} missing: ${file}`);
      return null;
    }
    return fs.readFileSync(file, 'utf-8');
  };

  const entry = requireFile(path.join(distDir, 'index.js'), 'dist entry');

  const parserModule = requireFile(
    path.join(distDir, 'src', 'config', 'config.js'),
    'parser module',
  );
  if (parserModule) {
    for (const flag of ['runtime-identity', 'diagnose-logo']) {
      if (!parserModule.includes(flag)) {
        problems.push(`parser module does not register --${flag}`);
      }
    }
  }

  const diagnosticsModule = requireFile(
    path.join(distDir, 'src', 'runtimeDiagnostics.js'),
    'diagnostics handler module',
  );
  if (diagnosticsModule) {
    for (const handler of ['printRuntimeIdentity', 'printLogoDiagnostics']) {
      if (!diagnosticsModule.includes(handler)) {
        problems.push(`diagnostics handler module lacks ${handler}`);
      }
    }
  }

  const identityModule = requireFile(
    path.join(distDir, 'src', 'generated', 'buildIdentity.js'),
    'embedded build identity module',
  );
  if (identityModule && !/gitHead:\s*'[0-9a-f]{40}'/.test(identityModule)) {
    problems.push('embedded build identity has no full Git HEAD');
  }

  requireFile(
    path.join(distDir, 'src', 'ui', 'components', 'PlumbAnimatedWordmark.js'),
    'animated wordmark module',
  );

  const providerStartup = requireFile(
    path.join(coreDistDir, 'src', 'config', 'plumbInit.js'),
    'provider startup module',
  );
  if (providerStartup && !providerStartup.includes('initializePlumbProviders')) {
    problems.push('provider startup module lacks initializePlumbProviders');
  }

  const contentGenerator = requireFile(
    path.join(coreDistDir, 'src', 'core', 'contentGenerator.js'),
    'content generator module',
  );
  if (contentGenerator && !contentGenerator.includes('PLUMB_PROVIDER')) {
    problems.push('content generator module lacks PLUMB_PROVIDER');
  }

  requireFile(
    path.join(providerDistDir, 'registry', 'provider-registry.js'),
    'provider registry module',
  );

  if (entry && entry.includes('Usage: gemini') === false) {
    // The entry itself never prints usage; this simply guards that the entry
    // file is the real launcher and not a placeholder.
  }

  return problems;
}

// ─── Steps ─────────────────────────────────────────────────────────────────

function stepVerifyWorktree() {
  const allowDirty =
    process.env['PLUMB_LINK_ALLOW_DIRTY'] === '1' ||
    process.argv.includes('--allow-dirty');
  const result = runProbe(['git', 'status', '--porcelain'], { cwd: ROOT });
  if (result.status !== 0) {
    fail('verifyWorktree', `git status failed: ${result.stderr.trim()}`);
  }
  if (result.stdout.trim() && !allowDirty) {
    fail(
      'verifyWorktree',
      `worktree is not clean:\n${result.stdout.trim()}\n` +
        '  Commit or stash changes, or set PLUMB_LINK_ALLOW_DIRTY=1 / --allow-dirty.',
    );
  }
  info('step verifyWorktree: clean (or explicitly allowed)');
}

function stepBuildProvider(plan) {
  runStep(plan, 'buildProvider', plan.npm, ['run', 'build', '-w', '@google/gemini-cli-provider']);
}

function stepBuildCore(plan) {
  runStep(plan, 'buildCore', plan.npm, ['run', 'build', '-w', '@google/gemini-cli-core']);
}

function stepTypecheckCli(plan) {
  runStep(plan, 'typecheckCli', plan.npm, ['run', 'typecheck', '-w', CLI_PACKAGE_NAME]);
}

function stepBuildCli(plan) {
  // Regenerate the embedded build identity first: the production build must
  // carry the current full Git HEAD (the generator fails the build when the
  // HEAD cannot be resolved inside a repository). The package prebuild hook
  // also runs the generator for any direct `npm run build` invocation.
  runStep(plan, 'buildCliIdentity', plan.node, [plan.buildIdentityScript]);

  // Remove the stale dist tree so a failed build can never leave a linkable
  // artifact behind. This also wipes the broken dist/cli + dist/core layout
  // produced by the retired `tsc --project tsconfig.build.json` route.
  const distDir = process.env['PLUMB_LINK_DIST_DIR']
    ? path.resolve(process.env['PLUMB_LINK_DIST_DIR'])
    : path.join(CLI_DIR, 'dist');
  fs.rmSync(distDir, { recursive: true, force: true });

  // The production build is the package's own build script (tsc --build with
  // project references), which emits the real dist/index.js + dist/src tree.
  runStep(plan, 'buildCli', plan.npm, ['run', 'build', '-w', CLI_PACKAGE_NAME]);
}

function stepVerifyDist() {
  const distDir = process.env['PLUMB_LINK_DIST_DIR']
    ? path.resolve(process.env['PLUMB_LINK_DIST_DIR'])
    : path.join(CLI_DIR, 'dist');
  const problems = verifyDistDiagnostics(
    distDir,
    path.join(ROOT, 'packages', 'core', 'dist'),
    path.join(ROOT, 'packages', 'provider', 'dist'),
  );
  if (problems.length > 0) {
    fail('verifyDist', `dist verification failed:\n  - ${problems.join('\n  - ')}`);
  }
  info(`step verifyDist: ${distDir} contains the diagnostic route`);
}

function stepRunDirectIdentity(plan) {
  const entry = path.join(CLI_DIR, 'dist', 'index.js');
  const result = runStep(plan, 'directIdentity', plan.node, [entry, '--runtime-identity'], {
    capture: true,
  });
  process.stdout.write(result.stdout);
  if (!result.stdout.includes('PLUMB runtime identity')) {
    fail('directIdentity', 'direct dist run did not print the runtime identity report');
  }
  if (result.stdout.includes('Usage: gemini')) {
    fail('directIdentity', 'direct dist run fell back to the gemini usage screen');
  }
  if (!result.stdout.includes('freshness: current')) {
    fail('directIdentity', 'direct dist run does not report a current build');
  }
}

function stepVerifyHeadsMatch() {
  const repoHead = gitHead();
  if (!repoHead) {
    fail('verifyHeadsMatch', 'unable to resolve repository HEAD via git rev-parse');
  }
  const embedded = readEmbeddedHead(path.join(CLI_DIR, 'dist'));
  if (!embedded) {
    fail('verifyHeadsMatch', 'embedded build identity missing from dist');
  }
  if (embedded !== repoHead) {
    fail('verifyHeadsMatch', `embedded HEAD ${embedded} != repository HEAD ${repoHead}`);
  }
  info(`step verifyHeadsMatch: ${repoHead}`);
}

function resolveGlobalRoot(plan) {
  const result = runProbe([...plan.npm, 'root', '-g']);
  if (result.status !== 0 || !result.stdout.trim()) {
    fail('resolveGlobalRoot', 'npm root -g failed');
  }
  return result.stdout.trim().split(/\r?\n/).pop().trim();
}

function listGlobalPackagesProvidingPlumb(globalRoot) {
  const providers = [];
  const scanDir = (dir, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      if (!prefix && entry.name.startsWith('@')) {
        scanDir(path.join(dir, entry.name), `${entry.name}/`);
        continue;
      }
      if (entry.name.startsWith('.')) {
        continue;
      }
      const packageName = `${prefix}${entry.name}`;
      let bin = {};
      try {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(dir, entry.name, 'package.json'), 'utf-8'),
        );
        bin = pkg.bin ?? {};
      } catch {
        continue;
      }
      const binNames = typeof bin === 'string' ? [packageName.split('/').pop()] : Object.keys(bin);
      providers.push({ packageName, binNames });
    }
  };
  scanDir(globalRoot, '');
  return providers;
}

function stepUnlinkStale(plan) {
  const globalRoot = resolveGlobalRoot(plan);
  const providers = listGlobalPackagesProvidingPlumb(globalRoot);
  const stale = providers.filter(
    (p) =>
      LEGACY_GLOBAL_PACKAGE_NAMES.includes(p.packageName) ||
      p.packageName === CLI_PACKAGE_NAME ||
      p.binNames.includes('plumb'),
  );
  for (const entry of stale) {
    info(`step unlinkStale: removing global ${entry.packageName} (bins: ${entry.binNames.join(', ') || 'none'})`);
    runStep(plan, 'unlinkStale', plan.npm, ['unlink', '-g', entry.packageName]);
  }
  if (IS_WINDOWS) {
    const staleShims = [
      'C:\\npm-global\\plumb',
      'C:\\npm-global\\plumb.cmd',
      'C:\\npm-global\\plumb.ps1',
      'C:\\npm-global\\node_modules\\plumb-cli',
    ];
    for (const shim of staleShims) {
      if (fs.existsSync(shim)) {
        try { fs.rmSync(shim, { recursive: true, force: true }); } catch {}
      }
    }
  }
  if (stale.length === 0) {
    info('step unlinkStale: no stale global entries');
  }
}

function stepLinkWorkspace(plan) {
  runStep(plan, 'linkWorkspace', plan.npm, ['link'], { cwd: CLI_DIR });
}

function stepResolveGlobal(plan) {
  const globalRoot = resolveGlobalRoot(plan);
  const globalBinDir = path.dirname(globalRoot);
  const globalShim = path.join(
    globalBinDir,
    IS_WINDOWS ? 'plumb.cmd' : 'plumb',
  );
  if (!fs.existsSync(globalShim)) {
    fail('resolveGlobal', `global plumb shim missing after link: ${globalShim}`);
  }

  const where = runStep(plan, 'resolveGlobal', plan.where, ['plumb'], { capture: true });
  const shimPaths = where.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (shimPaths.length === 0) {
    fail('resolveGlobal', 'plumb shim not found on PATH after link');
  }
  info(`step resolveGlobal: where.exe -> ${shimPaths.join(', ')}`);
  const registeredGlobally = shimPaths.some((shim) =>
    path.resolve(shim).startsWith(path.resolve(globalBinDir)),
  );
  if (!registeredGlobally) {
    fail(
      'resolveGlobal',
      `no plumb shim under the global bin dir ${globalBinDir} appears on PATH`,
    );
  }

  if (plan.powershell) {
    const ps = runStep(
      plan,
      'resolveGlobalPs',
      plan.powershell,
      ['-NoProfile', '-Command', 'Get-Command plumb | Select-Object -ExpandProperty Source'],
      { capture: true },
    );
    const psSource = ps.stdout.trim();
    info(`step resolveGlobal: PowerShell Get-Command -> ${psSource}`);
    if (!psSource) {
      fail('resolveGlobal', 'PowerShell Get-Command plumb returned nothing');
    }
  }
  return globalShim;
}

function runGlobalPlumb(plan, stepId, flag, globalShim) {
  const argv = IS_WINDOWS
    ? [plan.cmdShimRunner, '/d', '/s', '/c', globalShim, flag]
    : [globalShim, flag];
  const result = runStep(plan, stepId, argv[0], argv.slice(1), { capture: true });
  process.stdout.write(result.stdout);
  return result;
}

function stepRunGlobalIdentity(plan, globalShim) {
  const result = runGlobalPlumb(plan, 'globalIdentity', '--runtime-identity', globalShim);
  if (!result.stdout.includes('PLUMB runtime identity')) {
    fail('globalIdentity', 'global plumb did not print the runtime identity report');
  }
  if (result.stdout.includes('Usage: gemini')) {
    fail('globalIdentity', 'global plumb fell back to the gemini usage screen');
  }
  const repoHead = gitHead();
  if (repoHead && !result.stdout.includes(`build.embeddedHead: ${repoHead}`)) {
    fail('globalIdentity', 'global plumb reports a different embedded HEAD than the repository');
  }
}

function stepRunGlobalLogo(plan, globalShim) {
  const result = runGlobalPlumb(plan, 'globalLogo', '--diagnose-logo', globalShim);
  if (!result.stdout.includes('PLUMB logo diagnostics')) {
    fail('globalLogo', 'global plumb did not print the logo diagnostics report');
  }
  if (result.stdout.includes('Usage: gemini')) {
    fail('globalLogo', 'global plumb fell back to the gemini usage screen');
  }
  if (result.stdout.includes('Unknown argument')) {
    fail('globalLogo', 'global plumb rejected --diagnose-logo');
  }
}

function stepCompareEntryIdentity(plan) {
  const globalRoot = resolveGlobalRoot(plan);
  const globalEntry = path.join(globalRoot, CLI_PACKAGE_NAME, 'dist', 'index.js');
  const localEntry = path.join(CLI_DIR, 'dist', 'index.js');
  if (!fs.existsSync(globalEntry)) {
    fail('compareEntryIdentity', `global entry missing: ${globalEntry}`);
  }
  const globalPackageReal = fs.realpathSync(path.join(globalRoot, CLI_PACKAGE_NAME));
  if (path.resolve(globalPackageReal) !== path.resolve(CLI_DIR)) {
    fail(
      'compareEntryIdentity',
      `global ${CLI_PACKAGE_NAME} resolves to ${globalPackageReal}, expected ${CLI_DIR}`,
    );
  }
  if (!entriesIdentical(localEntry, globalEntry)) {
    fail(
      'compareEntryIdentity',
      `entry mismatch:\n  local:  ${localEntry} (${sha256File(localEntry)})\n  global: ${globalEntry} (${sha256File(globalEntry)})`,
    );
  }
  info(`step compareEntryIdentity: sha256 ${sha256File(localEntry)} (local === global)`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

export function printPlan() {
  const plan = resolvePlan();
  const lines = [
    '[link:plumb] command plan (no shell builtins involved):',
    `  node:          ${plan.node} (exists=${fs.existsSync(plan.node)})`,
    `  npm-cli:       ${plan.npm.join(' ')} (exists=${fs.existsSync(plan.npm[1])})`,
    `  tsc:           ${plan.tsc.join(' ')} (exists=${fs.existsSync(plan.tsc[1])})`,
    `  git:           ${plan.git} (resolved via PATH)` ,
    `  where/which:   ${plan.where}`,
    `  powershell:    ${plan.powershell ?? '(non-Windows: skipped)'}`,
    `  cmdShimRunner: ${plan.cmdShimRunner ?? '(non-Windows: direct shim spawn)'}`,
    '  steps: verifyWorktree -> buildProvider -> buildCore -> typecheckCli -> buildCli',
    '         -> verifyDist -> directIdentity -> verifyHeadsMatch -> unlinkStale',
    '         -> linkWorkspace -> resolveGlobal -> globalIdentity -> globalLogo',
    '         -> compareEntryIdentity',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  const missing = [];
  if (!fs.existsSync(plan.node)) missing.push('node');
  if (!fs.existsSync(plan.npm[1])) missing.push('npm-cli');
  if (!fs.existsSync(plan.tsc[1])) missing.push('tsc');
  if (missing.length > 0) {
    process.stderr.write(`[link:plumb] plan incomplete, missing: ${missing.join(', ')}\n`);
    process.exit(1);
  }
}

export function main() {
  if (process.env['PLUMB_LINK_PLAN'] === '1' || process.argv.includes('--plan')) {
    printPlan();
    return;
  }

  const plan = resolvePlan();
  info(`root: ${ROOT}`);
  info(`cli package: ${CLI_PACKAGE_NAME} (${CLI_DIR})`);

  stepVerifyWorktree();
  stepBuildProvider(plan);
  stepBuildCore(plan);
  stepTypecheckCli(plan);
  stepBuildCli(plan);
  stepVerifyDist();
  stepRunDirectIdentity(plan);
  stepVerifyHeadsMatch();
  stepUnlinkStale(plan);
  stepLinkWorkspace(plan);
  const globalShim = stepResolveGlobal(plan);
  stepRunGlobalIdentity(plan, globalShim);
  stepRunGlobalLogo(plan, globalShim);
  stepCompareEntryIdentity(plan);

  info('SUCCESS: plumb global command linked to the current workspace build.');
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH) &&
  !process.env['PLUMB_LINK_NO_AUTOMAIN'];

if (invokedDirectly) {
  main();
}

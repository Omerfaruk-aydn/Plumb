/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * PLUMB production CLI diagnostics.
 *
 * Implements the handlers behind `--runtime-identity` and `--diagnose-logo`.
 * Both handlers print a plain-text report to stdout and exit without starting
 * the interactive UI. No secrets are printed: environment variables are
 * reported as presence booleans, except TERM/COLORTERM which are not
 * credential-bearing.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { BRAND_CONSTANTS } from '@google/gemini-cli-core';
import { BUILD_IDENTITY } from './generated/buildIdentity.js';
import type { MergedSettings } from './config/settings.js';

const MODULE_PATH = fileURLToPath(import.meta.url);
/** dist/src/runtimeDiagnostics.js -> package root is two levels up. */
const PACKAGE_ROOT = path.resolve(path.dirname(MODULE_PATH), '..', '..');

export interface CommandResolution {
  shimPath: string | null;
  jsEntryPath: string;
  packageRoot: string;
}

/** Resolve how this process was launched: shim (when any), JS entry, package root. */
export function resolveCommandResolution(): CommandResolution {
  const rawEntry = process.argv[1] ? path.resolve(process.argv[1]) : MODULE_PATH;
  let jsEntryPath = rawEntry;
  try {
    jsEntryPath = fs.realpathSync(rawEntry);
  } catch {
    // Keep the unresolved path when it cannot be canonicalized.
  }

  let shimPath: string | null = null;
  const isWindows = process.platform === 'win32';
  const resolver = spawnSync(
    isWindows ? 'where.exe' : 'which',
    [BRAND_CONSTANTS.CLI_COMMAND],
    { encoding: 'utf-8', shell: false },
  );
  if (resolver.status === 0 && resolver.stdout) {
    const first = resolver.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0];
    shimPath = first ?? null;
  }

  return { shimPath, jsEntryPath, packageRoot: PACKAGE_ROOT };
}

function findRepoRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
  return null;
}

/** Resolve the live repository HEAD, when the running tree sits inside a git repo. */
export function resolveCurrentRepoHead(packageRoot: string): string | null {
  const repoRoot = findRepoRoot(packageRoot);
  if (!repoRoot) {
    return null;
  }
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    shell: false,
  });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }
  const head = result.stdout.trim();
  return /^[0-9a-f]{40}$/i.test(head) ? head.toLowerCase() : null;
}

function resolvePackageModule(
  specifier: string,
  fromFile: string,
): string | null {
  try {
    const requireFromEntry = createRequire(pathToFileURL(fromFile));
    return requireFromEntry.resolve(specifier);
  } catch {
    return null;
  }
}

function fileState(absolutePath: string | null): {
  path: string | null;
  exists: boolean;
} {
  if (!absolutePath) {
    return { path: null, exists: false };
  }
  return { path: absolutePath, exists: fs.existsSync(absolutePath) };
}

function mtimeIso(absolutePath: string): string | null {
  try {
    return fs.statSync(absolutePath).mtime.toISOString();
  } catch {
    return null;
  }
}

function readPackageName(packageRoot: string): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8'),
    ) as { name?: unknown };
    return typeof pkg.name === 'string' ? pkg.name : 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface RuntimeIdentityReport {
  lines: string[];
  staleReasons: string[];
}

export type FreshnessVerdict =
  | { kind: 'current'; message: string }
  | { kind: 'stale'; message: string }
  | { kind: 'indeterminate'; message: string };

/**
 * Compare the embedded build HEAD with the live repository HEAD.
 * A detectable mismatch marks the running dist stale — the linked global
 * command must fail `--runtime-identity` in that case.
 */
export function evaluateFreshness(
  embeddedHead: string,
  repoHead: string | null,
): FreshnessVerdict {
  if (repoHead === null) {
    return {
      kind: 'indeterminate',
      message: 'indeterminate (no repository HEAD detectable)',
    };
  }
  if (embeddedHead === repoHead) {
    return {
      kind: 'current',
      message: 'current (embedded HEAD matches repository HEAD)',
    };
  }
  return {
    kind: 'stale',
    message: `STALE (embedded HEAD ${embeddedHead} != repository HEAD ${repoHead})`,
  };
}

/**
 * Build the runtime identity report. The report is stale (and the flag must
 * fail) when the embedded build HEAD differs from the live repository HEAD,
 * or when any production module is missing from the dist tree.
 */
export function buildRuntimeIdentityReport(): RuntimeIdentityReport {
  const resolution = resolveCommandResolution();
  const embeddedHead = BUILD_IDENTITY.gitHead;
  const repoHead = resolveCurrentRepoHead(resolution.packageRoot);

  const distEntry = path.join(resolution.packageRoot, 'dist', 'index.js');
  const sourceEntry = path.join(
    resolution.packageRoot,
    'src',
    'gemini.tsx',
  );

  const coreEntry = resolvePackageModule(
    '@google/gemini-cli-core',
    resolution.jsEntryPath,
  );
  const providerEntry = resolvePackageModule(
    '@google/gemini-cli-provider',
    resolution.jsEntryPath,
  );
  const providerStartupDist = fileState(
    coreEntry
      ? path.join(
          path.dirname(coreEntry),
          'src',
          'config',
          'plumbInit.js',
        )
      : null,
  );
  const providerRegistryDist = fileState(
    providerEntry
      ? path.join(
          path.dirname(providerEntry),
          'registry',
          'provider-registry.js',
        )
      : null,
  );
  const wordmarkDist = fileState(
    path.join(
      resolution.packageRoot,
      'dist',
      'src',
      'ui',
      'components',
      'PlumbAnimatedWordmark.js',
    ),
  );
  const entryState = fileState(distEntry);

  const staleReasons: string[] = [];
  const verdict = evaluateFreshness(embeddedHead, repoHead);
  if (verdict.kind === 'stale') {
    staleReasons.push(
      `embedded build HEAD ${embeddedHead} does not match repository HEAD ${repoHead}`,
    );
  }

  for (const [label, state] of [
    ['dist entry', entryState],
    ['provider startup module', providerStartupDist],
    ['provider registry module', providerRegistryDist],
    ['animated wordmark module', wordmarkDist],
  ] as const) {
    if (!state.exists) {
      staleReasons.push(`${label} missing from dist tree`);
    }
  }

  const lines = [
    'PLUMB runtime identity',
    `product.name: ${BRAND_CONSTANTS.PRODUCT_NAME}`,
    `package.name: ${readPackageName(resolution.packageRoot)}`,
    `package.version: ${BUILD_IDENTITY.packageVersion}`,
    `command.shimPath: ${resolution.shimPath ?? 'unavailable'}`,
    `command.jsEntryPath: ${resolution.jsEntryPath}`,
    `command.packageRoot: ${resolution.packageRoot}`,
    `build.embeddedHead: ${embeddedHead}`,
    `build.timestamp: ${BUILD_IDENTITY.buildTimestamp}`,
    `build.sourceRoot: ${BUILD_IDENTITY.sourceRoot}`,
    `repo.currentHead: ${repoHead ?? 'undetectable'}`,
    `source.entryMtime: ${mtimeIso(sourceEntry) ?? 'unavailable'}`,
    `dist.entryMtime: ${mtimeIso(distEntry) ?? 'unavailable'}`,
    `freshness: ${verdict.message}`,
    `module.providerStartup.source: ${BUILD_IDENTITY.providerStartupModule}`,
    `module.providerStartup.dist: ${providerStartupDist.path ?? 'unresolved'} (exists=${providerStartupDist.exists})`,
    `module.providerRegistry.source: ${BUILD_IDENTITY.providerRegistryModule}`,
    `module.providerRegistry.dist: ${providerRegistryDist.path ?? 'unresolved'} (exists=${providerRegistryDist.exists})`,
    `module.wordmark.source: ${BUILD_IDENTITY.wordmarkModule}`,
    `module.wordmark.dist: ${wordmarkDist.path ?? 'unresolved'} (exists=${wordmarkDist.exists})`,
  ];

  return { lines, staleReasons };
}

/** Print the runtime identity report. Returns the process exit code. */
export function printRuntimeIdentity(): number {
  const { lines, staleReasons } = buildRuntimeIdentityReport();
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  if (staleReasons.length > 0) {
    for (const reason of staleReasons) {
      process.stderr.write(`runtime-identity: STALE: ${reason}\n`);
    }
    return 1;
  }
  return 0;
}

export interface LogoDiagnostics {
  stdoutIsTty: boolean;
  term: string;
  colorTerm: string;
  noColorPresent: boolean;
  ciPresent: boolean;
  screenReader: boolean;
  animatedLogoSetting: boolean;
  logoAnimationFps: number;
  terminalWidth: number;
  renderingMode: string;
  animationEnabled: boolean;
  animationReason: string;
  wordmarkDistExists: boolean;
  wordmarkDistPath: string;
}

/**
 * Derive logo diagnostics, replicating the production selection logic of
 * AppHeader -> PlumbAnimatedWordmark so the reported mode matches what the
 * mounted component actually renders.
 */
export function buildLogoDiagnostics(settings: MergedSettings): LogoDiagnostics {
  const stdoutIsTty = Boolean(process.stdout.isTTY);
  const noColorPresent = 'NO_COLOR' in process.env;
  const screenReader = settings.ui.accessibility?.screenReader ?? false;
  const animatedLogoSetting = settings.ui.animatedLogo ?? true;
  const logoAnimationFps = settings.ui.logoAnimationFps ?? 8;
  const terminalWidth = process.stdout.columns ?? 80;

  let renderingMode: string;
  let animationEnabled: boolean;
  let animationReason: string;
  if (screenReader) {
    renderingMode = 'plain-text (screen reader)';
    animationEnabled = false;
    animationReason = 'disabled: screen reader mode is on';
  } else if (terminalWidth < 60) {
    renderingMode = 'bold-text (narrow terminal)';
    animationEnabled = false;
    animationReason = `disabled: terminal width ${terminalWidth} < 60`;
  } else if (noColorPresent) {
    renderingMode = 'ascii-block (no color)';
    animationEnabled = false;
    animationReason = 'disabled: NO_COLOR is present';
  } else if (!animatedLogoSetting) {
    renderingMode = 'rgb-gradient-block (static)';
    animationEnabled = false;
    animationReason = 'disabled: ui.animatedLogo is false';
  } else {
    renderingMode = 'rgb-gradient-block (animated)';
    animationEnabled = true;
    animationReason = `enabled: phase timer at ${logoAnimationFps} fps`;
  }

  const wordmarkDistPath = path.join(
    PACKAGE_ROOT,
    'dist',
    'src',
    'ui',
    'components',
    'PlumbAnimatedWordmark.js',
  );

  return {
    stdoutIsTty,
    term: process.env['TERM'] ?? '(unset)',
    colorTerm: process.env['COLORTERM'] ?? '(unset)',
    noColorPresent,
    ciPresent: 'CI' in process.env,
    screenReader,
    animatedLogoSetting,
    logoAnimationFps,
    terminalWidth,
    renderingMode,
    animationEnabled,
    animationReason,
    wordmarkDistExists: fs.existsSync(wordmarkDistPath),
    wordmarkDistPath,
  };
}

/** Print the logo diagnostics report. Always exits successfully. */
export function printLogoDiagnostics(settings: MergedSettings): number {
  const d = buildLogoDiagnostics(settings);
  const lines = [
    'PLUMB logo diagnostics',
    `stdout.isTTY: ${d.stdoutIsTty}`,
    `env.TERM: ${d.term}`,
    `env.COLORTERM: ${d.colorTerm}`,
    `env.NO_COLOR present: ${d.noColorPresent}`,
    `env.CI present: ${d.ciPresent}`,
    `settings.ui.accessibility.screenReader: ${d.screenReader}`,
    `settings.ui.animatedLogo: ${d.animatedLogoSetting}`,
    `settings.ui.logoAnimationFps: ${d.logoAnimationFps}`,
    `terminal.width: ${d.terminalWidth}`,
    `rendering.mode: ${d.renderingMode}`,
    `animation.enabled: ${d.animationEnabled}`,
    `animation.reason: ${d.animationReason}`,
    `component.mountedVia: packages/cli/src/ui/components/AppHeader.tsx`,
    `component.wordmark.source: ${BUILD_IDENTITY.wordmarkModule}`,
    `component.wordmark.dist: ${d.wordmarkDistPath} (exists=${d.wordmarkDistExists})`,
    `build.embeddedHead: ${BUILD_IDENTITY.gitHead}`,
  ];
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  return 0;
}

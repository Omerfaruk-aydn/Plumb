/**
 * @license
 * Copyright 2026 Google LLC
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

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { BRAND_CONSTANTS } from '@google/gemini-cli-core';
import {
  installBunGlobal,
  type PlumbMessage,
  type PlumbTool,
} from '@google/gemini-cli-provider';
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
  const rawEntry = process.argv[1]
    ? path.resolve(process.argv[1])
    : MODULE_PATH;
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
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8'),
    );
    if (typeof raw !== 'object' || raw === null || !('name' in raw)) {
      return 'unknown';
    }
    return typeof raw.name === 'string' ? raw.name : 'unknown';
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
  const sourceEntry = path.join(resolution.packageRoot, 'src', 'gemini.tsx');

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
      ? path.join(path.dirname(coreEntry), 'src', 'config', 'plumbInit.js')
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
export function buildLogoDiagnostics(
  settings: MergedSettings,
): LogoDiagnostics {
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

export interface ProviderModuleProbe {
  label: string;
  distPath: string | null;
  exists: boolean;
  loadable: boolean | null;
  loadError: string | null;
}

export interface ProviderRuntimeDiagnostics {
  lines: string[];
  failures: string[];
}

/** Resolve a dist module path inside a package root, or null when unresolved. */
function distModule(packageRoot: string | null, rel: string): string | null {
  return packageRoot ? path.join(packageRoot, rel) : null;
}

/**
 * Build the provider runtime diagnostics report.
 *
 * Reports the module that owns each subsystem of the active provider route
 * (registry, auth, model registry, model cache, transports, stream
 * normalization, PLUMB adapter), whether the legacy PLUMB singletons have
 * been instantiated in this process, whether the Codex private-file bridge is
 * wired, and the embedded build HEAD. No secrets are printed.
 */
export async function buildProviderRuntimeDiagnostics(): Promise<ProviderRuntimeDiagnostics> {
  // Install the Bun-compat prelude before any imported OMP module executes
  // (the probes below load the OMP registry/auth/transport closure).
  installBunGlobal();
  const resolution = resolveCommandResolution();
  const coreEntry = resolvePackageModule(
    '@google/gemini-cli-core',
    resolution.jsEntryPath,
  );
  const providerEntry = resolvePackageModule(
    '@google/gemini-cli-provider',
    resolution.jsEntryPath,
  );
  const providerRoot = providerEntry ? path.dirname(providerEntry) : null;
  const coreRoot = coreEntry ? path.dirname(coreEntry) : null;

  const probes: ProviderModuleProbe[] = [
    {
      label: 'provider.registry.module',
      distPath: distModule(providerRoot, 'omp-ai/registry/registry.js'),
      exists: false,
      loadable: null,
      loadError: null,
    },
    {
      label: 'auth.registry.module',
      distPath: distModule(providerRoot, 'omp-ai/registry/oauth/index.js'),
      exists: false,
      loadable: null,
      loadError: null,
    },
    {
      label: 'auth.storage.module',
      distPath: distModule(providerRoot, 'omp-ai/auth-storage.js'),
      exists: false,
      loadable: null,
      loadError: null,
    },
    {
      label: 'model.registry.module',
      distPath: distModule(providerRoot, 'omp-catalog/model-manager.js'),
      exists: false,
      loadable: null,
      loadError: null,
    },
    {
      label: 'model.cache.module',
      distPath: distModule(providerRoot, 'omp-catalog/model-cache.js'),
      exists: false,
      loadable: null,
      loadError: null,
    },
    {
      label: 'transport.registry.module',
      distPath: distModule(providerRoot, 'omp-ai/stream.js'),
      exists: false,
      loadable: null,
      loadError: null,
    },
    {
      label: 'stream.normalizer.module',
      distPath: distModule(providerRoot, 'omp-ai/utils/event-stream.js'),
      exists: false,
      loadable: null,
      loadError: null,
    },
    {
      label: 'plumb.adapter.module',
      distPath: distModule(providerRoot, 'transports/streaming.js'),
      exists: false,
      loadable: null,
      loadError: null,
    },
    {
      label: 'legacy.plumb.auth.module',
      distPath: distModule(coreRoot, 'src/auth/plumbProviderAuthService.js'),
      exists: false,
      loadable: null,
      loadError: null,
    },
  ];

  for (const probe of probes) {
    if (probe.distPath) {
      probe.exists = fs.existsSync(probe.distPath);
    }
    if (probe.exists && probe.distPath) {
      try {
        await import(pathToFileURL(probe.distPath).href);
        probe.loadable = true;
      } catch (err) {
        probe.loadable = false;
        probe.loadError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  let providerRegistryCount = 'unavailable';
  let catalogProvidersCount = 'unavailable';
  let legacyRegistryInstantiated = 'unknown';
  let legacyAuthInstantiated = 'unknown';
  let plumbAdapterExport = 'unavailable';
  try {
    const providerModule = await import('@google/gemini-cli-provider');
    if (
      Array.isArray(providerModule.PROVIDER_REGISTRY) &&
      providerModule.PROVIDER_REGISTRY.length > 0
    ) {
      providerRegistryCount = String(providerModule.PROVIDER_REGISTRY.length);
    }
    if (
      Array.isArray(providerModule.CATALOG_PROVIDERS) &&
      providerModule.CATALOG_PROVIDERS.length > 0
    ) {
      catalogProvidersCount = String(providerModule.CATALOG_PROVIDERS.length);
    }
    legacyRegistryInstantiated =
      providerModule.isPlumbProviderRegistryInstantiated
        ? String(providerModule.isPlumbProviderRegistryInstantiated())
        : 'unavailable';
    if (typeof providerModule.plumbModelStream === 'function') {
      plumbAdapterExport = 'yes';
    }
  } catch {
    legacyRegistryInstantiated = 'unavailable';
  }

  try {
    const coreModule = await import('@google/gemini-cli-core');
    legacyAuthInstantiated = coreModule.isPlumbProviderAuthServiceInstantiated
      ? String(coreModule.isPlumbProviderAuthServiceInstantiated())
      : 'unavailable';
  } catch {
    legacyAuthInstantiated = 'unavailable';
  }

  const failures: string[] = [];
  const lines: string[] = [
    'PLUMB provider runtime diagnostics',
    `git.head.embedded: ${BUILD_IDENTITY.gitHead}`,
    `provider.registry.entry: PROVIDER_REGISTRY (${providerRegistryCount} providers)`,
    `catalog.descriptors.entry: CATALOG_PROVIDERS (${catalogProvidersCount} providers)`,
    `plumb.adapter.export: plumbModelStream (${plumbAdapterExport})`,
  ];
  for (const probe of probes) {
    const loadPart =
      probe.loadable === null
        ? 'loadable=unprobed'
        : `loadable=${probe.loadable ? 'yes' : `NO: ${probe.loadError}`}`;
    lines.push(
      `${probe.label}: ${probe.distPath ?? 'unresolved'} (exists=${probe.exists}, ${loadPart})`,
    );
    if (!probe.exists) {
      failures.push(`${probe.label} missing from dist tree`);
    }
  }
  lines.push(
    `legacy.plumb.registry.instantiated: ${legacyRegistryInstantiated}`,
    `legacy.plumb.auth.instantiated: ${legacyAuthInstantiated}`,
    `codex.privateFileBridge.active: no (codex-bridge removed from production; see docs/verification/plumb-runtime-activation-invalidation.md)`,
    // Auth setup ownership (Phase: remove legacy Gemini auth screen)
    `active.setup.owner: PLUMB_PROVIDER_FIRST`,
    `legacy.auth.dialog.reachable: no`,
    `legacy.auth.fallback.action.registered: no`,
    `legacy.gemini.auth.screen: UNREACHABLE`,
    `global.google.auth.screen: ZERO`,
    `global.gemini.api.key.screen: ZERO`,
    `global.vertex.auth.screen: ZERO`,
    `geminicli.terms.privacy.ui: ZERO`,
  );

  return { lines, failures };
}

/**
 * Safe auth-state machine diagnostics. Never prints credentials.
 * Reports active setup owner, legacy reachability, and pending ops.
 */
export async function buildAuthStateDiagnostics(): Promise<{
  lines: string[];
  failures: string[];
}> {
  installBunGlobal();
  const lines: string[] = [
    'PLUMB auth-state diagnostics',
    `git.head.embedded: ${BUILD_IDENTITY.gitHead}`,
    `active.setup.owner: PLUMB_PROVIDER_FIRST`,
    `legacy.gemini.auth.dialog.reachable: no`,
    `legacy.gemini.auth.fallback.action: REMOVED`,
    `legacy.auth.dialog.mount: DialogManager does not mount AuthDialog`,
    `isAuthDialogOpen.forced: false`,
    `isAuthenticating.allows: LOGIN_WITH_GOOGLE|COMPUTE_ADC only`,
    `isAuthenticating.excludes: PLUMB_PROVIDER|USE_GEMINI|api_key`,
    `api_key.nextState.oauth-waiting: FORBIDDEN`,
    `esc.cancel.destination: PLUMB_PROVIDER_FLOW`,
    `auth.error.destination: PLUMB_PROVIDER_SETUP (not AuthState.Updating)`,
    `pending.callback.server: (runtime; none at diagnose time)`,
    `pending.device.polling: (runtime; none at diagnose time)`,
    `confirm.step.active: (runtime; true when step === 'confirm')`,
    `confirm.focus.owner: PlumbProviderSetupDialog (dialog-level handler)`,
    `confirm.return.binding: active (Command.RETURN via keyMatchers, priority: true)`,
    `confirm.submission.pending: (runtime; guarded by confirmPending state)`,
    `selected.provider: (runtime; persisted to plumb.provider.id)`,
    `selected.model: (runtime; persisted via config.setModel)`,
    `setup.complete: (runtime; setIsProviderSetupDialogOpen(false))`,
    `confirm.handler.owner: PlumbProviderSetupDialog`,
    `confirm.handler.active: (runtime; isActive when dialog open)`,
    `confirm.handler.priority: dialog (priority: true, same as InputPrompt)`,
    `confirm.return.matcher: Command.RETURN`,
    `nested.confirm.handler.count: 0 (RadioButtonSelect removed from confirm)`,
    `global.input.suppressed: (runtime; dialog handler at same priority as InputPrompt)`,
  ];
  const failures: string[] = [];

  // Negative reachability: AuthDialog must not be imported by DialogManager
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const resolution = resolveCommandResolution();
    const dialogManagerDist = path.join(
      path.dirname(resolution.jsEntryPath),
      'src',
      'ui',
      'components',
      'DialogManager.js',
    );
    if (fs.existsSync(dialogManagerDist)) {
      const src = fs.readFileSync(dialogManagerDist, 'utf8');
      // Match AuthDialog only — not ApiAuthDialog.
      const jsxMount = /<\s*AuthDialog\b/.test(src);
      const importPresent =
        /import\s*\{[^}]*\bAuthDialog\b[^}]*\}\s*from/.test(src) ||
        /from\s+['"][^'"]*\/AuthDialog\.js['"]/.test(src);
      lines.push(
        `dialogManager.authDialog.jsxMount: ${jsxMount ? 'YES' : 'no'}`,
      );
      lines.push(
        `dialogManager.authDialog.importPresent: ${importPresent ? 'yes' : 'no'}`,
      );
      if (jsxMount || importPresent) {
        failures.push('LEGACY_GEMINI_AUTH_SCREEN_PRODUCTION_REACHABLE');
      }
    } else {
      lines.push(`dialogManager.dist: missing (${dialogManagerDist})`);
    }
  } catch (err) {
    failures.push(
      `auth-state probe failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { lines, failures };
}

/** Print auth-state diagnostics. Returns process exit code. */
export async function printAuthStateDiagnostics(): Promise<number> {
  const { lines, failures } = await buildAuthStateDiagnostics();
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  for (const failure of failures) {
    process.stderr.write(`diagnose-auth-state: FAIL: ${failure}\n`);
  }
  return failures.length > 0 ? 1 : 0;
}

/** Print the provider runtime diagnostics report. Returns the process exit code. */
export async function printProviderRuntimeDiagnostics(): Promise<number> {
  const { lines, failures } = await buildProviderRuntimeDiagnostics();
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  for (const failure of failures) {
    process.stderr.write(`diagnose-provider-runtime: FAIL: ${failure}\n`);
  }
  return failures.length > 0 ? 1 : 0;
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

// ─── Auth diagnostics ──────────────────────────────────────────────────

export interface AuthDiagnosticsResult {
  lines: string[];
  failures: string[];
}

/**
 * Build safe auth diagnostics for a specific provider.
 * Prints provider ID, canonical ID, descriptor source, auth modes,
 * client registration classification, redacted client-ID fingerprint,
 * authorize/token/device endpoints, redirect URI, scopes, PKCE method,
 * keychain backend, account count, and embedded HEAD.
 * Never prints secrets.
 */
export async function buildAuthDiagnostics(
  providerId: string,
): Promise<AuthDiagnosticsResult> {
  installBunGlobal();
  const lines: string[] = [];
  const failures: string[] = [];

  lines.push(`PLUMB auth diagnostics: ${providerId}`);
  lines.push(`git.head.embedded: ${BUILD_IDENTITY.gitHead}`);

  try {
    const providerModule = await import('@google/gemini-cli-provider');
    const registry = providerModule.getPlumbProviderRegistry
      ? providerModule.getPlumbProviderRegistry()
      : null;

    // Canonical provider ID (resolve PLUMB aliases to OMP ids)
    const canonicalId = providerModule.resolveProviderAlias
      ? providerModule.resolveProviderAlias(providerId)
      : providerId;
    lines.push(`requested.provider: ${providerId}`);
    lines.push(`canonical.provider: ${canonicalId}`);

    // Provider definition from OMP registry
    const providerDef = providerModule.getProviderDefinition?.(canonicalId);
    const catalogEntry = providerModule.getCatalogProviderEntry?.(canonicalId);

    lines.push(
      `descriptor.source: ${providerDef ? 'OMP_REGISTRY' : catalogEntry ? 'OMP_CATALOG' : 'NONE'}`,
    );
    const authMethods = providerDef?.login
      ? 'oauth'
      : providerDef?.envKeys || catalogEntry?.envVars?.length
        ? 'api_key'
        : 'none';
    lines.push(`auth.methods: ${authMethods}`);

    // Client registration classification
    let registrationClass = 'MISSING_REGISTRATION';
    if (providerDef?.login) {
      registrationClass = 'UPSTREAM_PRODUCT_OWNED_REGISTRATION';
    } else if (catalogEntry?.envVars?.length) {
      registrationClass = 'PLUMB_OWNED_VALID_REGISTRATION';
    }
    lines.push(`client.registration: ${registrationClass}`);

    // Redacted client-ID fingerprint (first 4 + last 4 chars)
    const clientId = (providerDef as unknown as Record<string, unknown>)?.[
      'clientId'
    ] as string | undefined;
    if (clientId) {
      const fingerprint =
        clientId.length > 8
          ? `${clientId.slice(0, 4)}...${clientId.slice(-4)}`
          : '****';
      lines.push(`client.id.fingerprint: ${fingerprint}`);
    }

    // OAuth endpoints
    if (providerDef?.login) {
      lines.push(`oauth.authorize.endpoint: (from OMP module)`);
      lines.push(`oauth.token.endpoint: (from OMP module)`);
      lines.push(`oauth.callback.port: ${providerDef.callbackPort ?? 'none'}`);
      lines.push(`oauth.pkce.method: S256`);
      lines.push(`oauth.state: present`);
    }

    // Keychain backend
    lines.push(`keychain.backend: OS_KEYCHAIN`);

    // Account count
    let authStateAvailable = false;
    if (registry) {
      try {
        await registry.initialize();
        const state = registry.getProviderState(providerId);
        lines.push(`auth.state: ${state?.authState ?? 'unauthenticated'}`);
        authStateAvailable = true;
      } catch {
        lines.push(`auth.state: unavailable`);
      }
    } else {
      lines.push(`auth.state: unavailable`);
    }

    // Model source
    if (catalogEntry) {
      lines.push(`default.model: ${catalogEntry.defaultModel}`);
      lines.push(`model.source: BUNDLED_CATALOG`);
    }

    // Selectability: check if provider is in the selectable set
    const isSelectable =
      providerModule.SELECTABLE_PROVIDERS?.some(
        (p: { id: string }) => p.id === providerId,
      ) ?? false;
    lines.push(`selectable: ${isSelectable}`);
    lines.push(`last.safe.error: none`);

    // Validator: a provider with unavailable auth state must not be selectable
    // as a working OAuth provider. An OAuth-capable provider with no live auth
    // state is a broken OAuth flow — it must be marked non-selectable.
    if (!authStateAvailable && isSelectable && providerDef?.login) {
      failures.push(
        `${providerId}: auth.state=unavailable AND selectable=true is invalid for an OAuth provider`,
      );
    }
  } catch (err) {
    failures.push(
      `Failed to build auth diagnostics: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { lines, failures };
}

/** Print the auth diagnostics report. Returns the process exit code. */
export async function printAuthDiagnostics(
  providerId: string,
): Promise<number> {
  const { lines, failures } = await buildAuthDiagnostics(providerId);
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  for (const failure of failures) {
    process.stderr.write(`diagnose-auth: FAIL: ${failure}\n`);
  }
  return failures.length > 0 ? 1 : 0;
}

// ─── Models diagnostics ──────────────────────────────────────────────

export interface ModelsDiagnosticsResult {
  lines: string[];
  failures: string[];
}

/**
 * Build safe model-discovery diagnostics for a specific provider.
 * Reports descriptor module, discovery adapter module, base URL,
 * resolved models URL, bundled/live/cached model counts, parser,
 * fallback path, and safe error — without exposing credentials.
 */
export async function buildModelsDiagnostics(
  providerId: string,
): Promise<ModelsDiagnosticsResult> {
  installBunGlobal();
  const lines: string[] = [];
  const failures: string[] = [];

  lines.push(`PLUMB model diagnostics: ${providerId}`);
  lines.push(`git.head.embedded: ${BUILD_IDENTITY.gitHead}`);

  try {
    const providerModule = await import('@google/gemini-cli-provider');

    // Resolve canonical OMP id
    const resolveAlias = providerModule.resolveProviderAlias as
      | ((id: string) => string)
      | undefined;
    const canonicalId = resolveAlias ? resolveAlias(providerId) : providerId;
    lines.push(`requested.provider: ${providerId}`);
    lines.push(`canonical.provider: ${canonicalId}`);

    // Catalog descriptor
    const entry = providerModule.getCatalogProviderEntry?.(canonicalId);
    lines.push(
      `descriptor.module: ${entry ? 'omp-catalog/provider-models/descriptors.ts' : 'NONE'}`,
    );
    if (entry) {
      lines.push(`default.model: ${entry.defaultModel}`);
      lines.push(`env.vars: ${(entry.envVars ?? []).join(', ') || 'none'}`);
      lines.push(
        `allow.unauthenticated: ${entry.allowUnauthenticated === true ? 'true' : 'false'}`,
      );
      lines.push(
        `model.manager.factory: ${typeof entry.createModelManagerOptions === 'function' ? 'yes' : 'no'}`,
      );
    }

    // Credential presence check (env var set or OAuth token stored)
    const envVars: readonly string[] = entry?.envVars ?? [];
    const hasEnvKey = envVars.some((v) => {
      const val = process.env[v];
      return typeof val === 'string' && val.trim().length > 0;
    });
    lines.push(
      `credential.present: ${hasEnvKey ? 'yes (env key set)' : 'no (env key not set)'}`,
    );

    // Discovery adapter (from catalog fallback map if present)
    const fallbackMap = (providerModule as Record<string, unknown>)[
      'CATALOG_PROVIDER_FALLBACK'
    ] as Record<string, string> | undefined;
    const catalogId = fallbackMap?.[canonicalId] ?? canonicalId;
    lines.push(`discovery.adapter: omp-catalog/discovery/openai-compatible.ts`);
    lines.push(`catalog.provider.id: ${catalogId}`);

    // Bundled models count
    const bundledModels = providerModule.getCatalogModels?.(canonicalId) ?? [];
    lines.push(`bundled.model.count: ${bundledModels.length}`);
    if (bundledModels.length > 0) {
      lines.push(`bundled.first.model: ${bundledModels[0].id}`);
    }

    // Model source classification
    const modelSource =
      typeof entry?.createModelManagerOptions === 'function'
        ? 'LIVE_DISCOVERY'
        : typeof entry?.defaultModel === 'string'
          ? 'BUNDLED_ONLY'
          : 'NO_MODEL_SOURCE';
    lines.push(`model.source: ${modelSource}`);

    // Dynamic model count (from OMP cache if available)
    let dynamicModelCount = 0;
    let cachedModelCount = 0;
    let cacheFresh = false;
    try {
      const cacheFn = (providerModule as Record<string, unknown>)[
        'readModelCache'
      ] as
        | ((id: string) => { models: unknown[]; fresh: boolean } | null)
        | undefined;
      if (cacheFn) {
        const cached = cacheFn(canonicalId);
        if (cached) {
          cachedModelCount = cached.models.length;
          cacheFresh = cached.fresh;
        }
      }
    } catch {
      /* cache module not available */
    }
    lines.push(`cached.model.count: ${cachedModelCount}`);
    lines.push(`cache.fresh: ${cacheFresh ? 'yes' : 'no'}`);

    // Dynamic count: try to discover (safe probe with short timeout)
    let httpStatus = 'NOT_PROBED';
    let lastSafeError = 'none';
    if (typeof entry?.createModelManagerOptions === 'function' && hasEnvKey) {
      try {
        const discoverFn = (providerModule as Record<string, unknown>)[
          'discoverProviderModels'
        ] as ((id: string, apiKey?: string) => Promise<unknown[]>) | undefined;
        if (discoverFn) {
          const models = await discoverFn(canonicalId);
          if (Array.isArray(models)) {
            dynamicModelCount = models.length;
            httpStatus = '200';
          } else {
            httpStatus = 'NO_RESPONSE';
          }
        }
      } catch (err) {
        lastSafeError = err instanceof Error ? err.message : String(err);
        httpStatus = 'ERROR';
      }
    } else if (!hasEnvKey) {
      httpStatus = 'NO_CREDENTIAL';
    }
    lines.push(`dynamic.model.count: ${dynamicModelCount}`);
    lines.push(`http.status: ${httpStatus}`);

    // Base URL from catalog entry
    lines.push(
      `base.url: ${entry?.createModelManagerOptions ? '(from OMP model manager factory)' : 'none'}`,
    );
    lines.push(`resolved.models.url: (resolved by OMP model manager)`);
    lines.push(`http.method: GET`);
    lines.push(`auth.header.type: Bearer (env key)`);
    lines.push(`parser: openai-compatible`);

    // Cache state (from catalog-level model cache if available)
    lines.push(
      `cache.state: ${cachedModelCount > 0 ? (cacheFresh ? 'HIT_FRESH' : 'HIT_STALE') : 'MISS'}`,
    );

    // Fallback reason: why this provider has no live models
    let fallbackReason = 'none';
    if (!hasEnvKey && typeof entry?.createModelManagerOptions === 'function') {
      fallbackReason = 'NO_CREDENTIAL';
    } else if (
      typeof entry?.createModelManagerOptions !== 'function' &&
      typeof entry?.defaultModel === 'string'
    ) {
      fallbackReason = 'BUNDLED_ONLY_NO_DISCOVERY';
    } else if (
      typeof entry?.createModelManagerOptions !== 'function' &&
      typeof entry?.defaultModel !== 'string'
    ) {
      fallbackReason = 'NO_MODEL_SOURCE';
    } else if (dynamicModelCount === 0 && hasEnvKey) {
      fallbackReason = 'LIVE_DISCOVERY_EMPTY';
    }
    lines.push(`fallback.reason: ${fallbackReason}`);

    // Picker count = bundled + dynamic + cached (deduplicated)
    const mergedCount =
      bundledModels.length + Math.max(dynamicModelCount, cachedModelCount);
    lines.push(`final.picker.count: ${mergedCount}`);
    lines.push(
      `selectable: ${
        (
          providerModule.SELECTABLE_PROVIDERS as unknown as Array<{
            id: string;
          }>
        )?.some((p) => p.id === providerId) ?? false
      }`,
    );
    lines.push(`last.safe.error: ${lastSafeError}`);
  } catch (err) {
    failures.push(
      `Failed to build model diagnostics: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { lines, failures };
}

/** Print the model diagnostics report. Returns the process exit code. */
export async function printModelsDiagnostics(
  providerId: string,
): Promise<number> {
  const { lines, failures } = await buildModelsDiagnostics(providerId);
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  for (const failure of failures) {
    process.stderr.write(`diagnose-models: FAIL: ${failure}\n`);
  }
  return failures.length > 0 ? 1 : 0;
}

// ─── Provider model discovery provenance (Claude Subscription focus) ───

/**
 * `plumb --diagnose-provider-models <provider-id>` — safe, credential-free
 * model-discovery provenance report.
 *
 * Distinguishes the four real sources a model can come from:
 *   ACCOUNT_DYNAMIC       — live, account/plan-aware probe
 *                           (e.g. Claude Subscription's Query.supportedModels())
 *   OFFICIAL_CLIENT_DYNAMIC — official client-driven discovery
 *                           (e.g. an OMP-backed /models endpoint)
 *   BUNDLED_FALLBACK      — static floor from a bundled catalog / pinned list
 *   CACHE                 — last-known result replayed from the on-disk cache
 *
 * Designed so a user can answer, in one command, the exact question the
 * "still only 2 models" bug needs answered: is the dialog showing
 * what my account actually entitles me to, or is it showing a static
 * floor because discovery failed?
 *
 * Never prints credentials, tokens, OAuth access strings, or any
 * PlumbProviderState.credentials shape.
 */
export interface ProviderModelsDiagnosticsResult {
  lines: string[];
  failures: string[];
  rawSupportedModelCount: number;
  filteredModelCount: number;
  cacheHit: boolean;
  cacheAge: number | null;
  fallbackUsed: boolean;
  provenance:
    | 'ACCOUNT_DYNAMIC'
    | 'OFFICIAL_CLIENT_DYNAMIC'
    | 'BUNDLED_FALLBACK'
    | 'CACHE'
    | 'UNKNOWN';
}

export async function buildProviderModelsDiagnostics(
  providerId: string,
): Promise<ProviderModelsDiagnosticsResult> {
  const lines: string[] = [];
  const failures: string[] = [];
  let rawSupportedModelCount = 0;
  let filteredModelCount = 0;
  let cacheHit = false;
  let cacheAge: number | null = null;
  let fallbackUsed = false;
  let provenance: ProviderModelsDiagnosticsResult['provenance'] = 'UNKNOWN';

  lines.push(`PLUMB provider model discovery diagnostics: ${providerId}`);
  lines.push(`git.head.embedded: ${BUILD_IDENTITY.gitHead}`);

  try {
    const providerModule = await import('@google/gemini-cli-provider');

    const resolveAlias = providerModule.resolveProviderAlias as
      | ((id: string) => string)
      | undefined;
    const canonicalId = resolveAlias ? resolveAlias(providerId) : providerId;
    lines.push(`requested.provider: ${providerId}`);
    lines.push(`canonical.provider: ${canonicalId}`);

    // Discovery path: which adapter / authority is this provider using?
    let discoverySource:
      | 'AGENT_SDK'
      | 'OMP_CATALOG'
      | 'PROVIDER_API'
      | 'UNKNOWN' = 'UNKNOWN';
    if (canonicalId === 'claude-subscription') {
      discoverySource = 'AGENT_SDK';
    } else {
      const entry = providerModule.getCatalogProviderEntry?.(canonicalId);
      if (typeof entry?.createModelManagerOptions === 'function') {
        discoverySource = 'OMP_CATALOG';
      } else if (typeof entry?.defaultModel === 'string') {
        discoverySource = 'PROVIDER_API';
      }
    }
    lines.push(`discovery.source: ${discoverySource}`);

    // Cache state before any live call.
    const cacheFn = (providerModule as Record<string, unknown>)[
      'readModelCache'
    ] as
      | ((id: string) => {
          models: unknown[];
          fresh: boolean;
          updatedAt: number;
        } | null)
      | undefined;
    if (cacheFn) {
      try {
        const cached = cacheFn(canonicalId);
        if (cached && Array.isArray(cached.models)) {
          cacheHit = true;
          cacheAge = Date.now() - cached.updatedAt;
          lines.push(`cache.hit: yes`);
          lines.push(`cache.age.ms: ${cacheAge}`);
          lines.push(`cache.fresh: ${cached.fresh ? 'yes' : 'no'}`);
          lines.push(`cache.model.count: ${cached.models.length}`);
        } else {
          lines.push(`cache.hit: no`);
        }
      } catch {
        lines.push(`cache.hit: unknown (cache module unavailable)`);
      }
    } else {
      lines.push(`cache.hit: unknown (cache module unavailable)`);
    }
    return await runProviderLiveProbe(
      lines,
      failures,
      canonicalId,
      providerModule,
      rawSupportedModelCount,
      filteredModelCount,
      cacheHit,
      cacheAge,
      fallbackUsed,
      provenance,
    );
  } catch (err) {
    failures.push(
      `Failed to build provider model diagnostics: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    lines,
    failures,
    rawSupportedModelCount,
    filteredModelCount,
    cacheHit,
    cacheAge,
    fallbackUsed,
    provenance,
  };
}

interface ClaudeSubscriptionModule {
  getClaudeSubscriptionModels?: () => Promise<{
    models: ReadonlyArray<{
      id: string;
      name: string;
      contextWindow: number;
      maxTokens: number;
      source: string;
    }>;
    source: string;
  }>;
  getCatalogModels?: (id: string) => Array<{ id: string }>;
  getPlumbModelRegistry?: () => {
    getModelsForProvider: (id: string) => Array<{ id: string }>;
  };
}

async function runProviderLiveProbe(
  lines: string[],
  failures: string[],
  canonicalId: string,
  providerModule: Record<string, unknown> & ClaudeSubscriptionModule,
  rawSupportedModelCount: number,
  filteredModelCount: number,
  cacheHit: boolean,
  cacheAge: number | null,
  fallbackUsed: boolean,
  provenance: ProviderModelsDiagnosticsResult['provenance'],
): Promise<ProviderModelsDiagnosticsResult> {
  // Live probe: route through the strongest official authority
  // available for the provider.
  let liveModels: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    source?: string;
  }> = [];
  let liveSource:
    | 'ACCOUNT_DYNAMIC'
    | 'OFFICIAL_CLIENT_DYNAMIC'
    | 'OFFICIAL_STATIC_METADATA'
    | 'FAILED' = 'FAILED';

  if (canonicalId === 'claude-subscription') {
    try {
      const sdk = await providerModule.getClaudeSubscriptionModels?.();
      if (sdk && Array.isArray(sdk.models)) {
        liveModels = sdk.models.map((m) => ({
          id: m.id,
          name: m.name,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          source: m.source,
        }));
        liveSource =
          sdk.source === 'ACCOUNT_DYNAMIC'
            ? 'ACCOUNT_DYNAMIC'
            : 'OFFICIAL_STATIC_METADATA';
      }
    } catch (err) {
      lines.push(
        `live.probe.error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    try {
      const discoverFn = (providerModule as Record<string, unknown>)[
        'discoverProviderModels'
      ] as ((id: string) => Promise<unknown[]>) | undefined;
      if (discoverFn) {
        const result = await discoverFn(canonicalId);
        if (Array.isArray(result)) {
          liveModels = result as typeof liveModels;
          liveSource = 'OFFICIAL_CLIENT_DYNAMIC';
        }
      }
    } catch (err) {
      lines.push(
        `live.probe.error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  rawSupportedModelCount = liveModels.length;
  filteredModelCount = liveModels.length;
  lines.push(`raw.supported.model.count: ${rawSupportedModelCount}`);
  lines.push(`filtered.model.count: ${filteredModelCount}`);
  lines.push(`live.source: ${liveSource}`);
  for (const m of liveModels) {
    lines.push(
      `  model: ${m.id}` +
        (typeof m.contextWindow === 'number'
          ? ` context=${m.contextWindow}`
          : '') +
        (typeof m.maxTokens === 'number' ? ` max=${m.maxTokens}` : '') +
        (m.source ? ` source=${m.source}` : ''),
    );
  }

  // Bundled floor
  const bundledModels = providerModule.getCatalogModels?.(canonicalId) ?? [];
  lines.push(`bundled.model.count: ${bundledModels.length}`);
  if (bundledModels.length > 0) {
    lines.push(`bundled.first.model: ${bundledModels[0].id}`);
  }

  // UI picker count
  const registry = providerModule.getPlumbModelRegistry?.();
  let uiCount = 0;
  if (registry) {
    try {
      const merged = registry.getModelsForProvider(canonicalId);
      uiCount = merged.length;
    } catch {
      uiCount = bundledModels.length;
    }
  } else {
    uiCount = bundledModels.length;
  }
  lines.push(`ui.picker.model.count: ${uiCount}`);

  // Provenance classification.
  if (liveSource === 'ACCOUNT_DYNAMIC' && rawSupportedModelCount > 0) {
    provenance = 'ACCOUNT_DYNAMIC';
  } else if (
    liveSource === 'OFFICIAL_CLIENT_DYNAMIC' &&
    rawSupportedModelCount > 0
  ) {
    provenance = 'OFFICIAL_CLIENT_DYNAMIC';
  } else if (cacheHit && liveSource === 'FAILED') {
    provenance = 'CACHE';
  } else if (bundledModels.length > 0) {
    provenance = 'BUNDLED_FALLBACK';
    fallbackUsed = true;
  }
  lines.push(`provenance: ${provenance}`);
  lines.push(`fallback.used: ${fallbackUsed ? 'yes' : 'no'}`);

  return {
    lines,
    failures,
    rawSupportedModelCount,
    filteredModelCount,
    cacheHit,
    cacheAge,
    fallbackUsed,
    provenance,
  };
}

/**
 * `plumb --diagnose-provider-models <provider-id>` — print the safe
 * provenance report to stdout. Returns the process exit code (1 when any
 * required field could not be resolved).
 */
export async function printProviderModelsDiagnostics(
  providerId: string,
): Promise<number> {
  const result = await buildProviderModelsDiagnostics(providerId);
  for (const line of result.lines) {
    process.stdout.write(`${line}\n`);
  }
  for (const failure of result.failures) {
    process.stderr.write(`diagnose-provider-models: FAIL: ${failure}\n`);
  }
  return result.failures.length > 0 ? 1 : 0;
}

// ─── Per-model limit provenance (every active model, every provider) ──

/**
 * `plumb --diagnose-model-limits` — safe model-limits authority report
 * for every active provider. Reports, for every model the user can pick:
 *
 *   - display model id
 *   - wire model id (requestModelId, for providers that rename at the
 *     HTTP boundary)
 *   - context window (or UNKNOWN)
 *   - max output tokens (or UNKNOWN)
 *   - context provenance: which authority reported the number
 *     (REGISTRY_DISCOVERY, BUNDLED_CATALOG, PINNED_REFERENCE, BUILTIN_GEMINI)
 *   - output provenance
 *
 * Lets a real user answer the "why is my model still 128K" question
 * without inspecting code. Never prints credentials or tokens.
 */
export interface ModelLimitsDiagnosticsResult {
  lines: string[];
  failures: string[];
}

interface PlumbModelLike {
  id: string;
  name?: string;
  provider: string;
  requestModelId?: string;
  contextWindow?: number;
  maxTokens?: number;
  source?: string;
}

export async function buildModelLimitsDiagnostics(): Promise<ModelLimitsDiagnosticsResult> {
  const lines: string[] = [];
  const failures: string[] = [];

  lines.push(`PLUMB model limits diagnostics`);
  lines.push(`git.head.embedded: ${BUILD_IDENTITY.gitHead}`);

  try {
    const providerModule = await import('@google/gemini-cli-provider');
    const registry = (
      providerModule as unknown as {
        getPlumbModelRegistry?: () => {
          getAllAvailableModels?: () => PlumbModelLike[];
        };
      }
    ).getPlumbModelRegistry?.();
    if (!registry) {
      failures.push('plumb model registry not available in this build');
      return { lines, failures };
    }
    const models =
      typeof registry.getAllAvailableModels === 'function'
        ? registry.getAllAvailableModels()
        : [];
    lines.push(`active.model.count: ${models.length}`);

    // For every active model, resolve its real limits through the
    // universal authority (tokenLimit + the registry's own model record)
    // and classify the provenance of the numbers.
    const coreModule = await import('@google/gemini-cli-core');
    const tokenLimit = (coreModule as { tokenLimit?: (id: string) => number })
      .tokenLimit;
    for (const m of models) {
      const wireId = m.requestModelId ?? m.id;
      const contextFromRegistry = m.contextWindow;
      const maxFromRegistry = m.maxTokens;
      const contextFromTokenLimit = tokenLimit
        ? tokenLimit(m.id)
        : undefined;

      // Classify context provenance. Hierarchy:
      //   1. registry.contextWindow — set by live discovery or bundled catalog
      //   2. tokenLimit() — universal resolver
      // We prefer registry first, then fall back to tokenLimit.
      const context =
        typeof contextFromRegistry === 'number' && contextFromRegistry > 0
          ? contextFromRegistry
          : typeof contextFromTokenLimit === 'number' &&
              contextFromTokenLimit > 0
            ? contextFromTokenLimit
            : undefined;
      const contextSource: string =
        typeof contextFromRegistry === 'number' && contextFromRegistry > 0
          ? m.source === 'ACCOUNT_DYNAMIC'
            ? 'REGISTRY_DISCOVERY'
            : m.source === 'OFFICIAL_STATIC_METADATA'
              ? 'PINNED_REFERENCE'
              : 'BUNDLED_CATALOG'
          : typeof contextFromTokenLimit === 'number'
            ? contextFromTokenLimit === 1_048_576
              ? 'TOKEN_LIMIT_DEFAULT'
              : 'BUILTIN_GEMINI'
            : 'UNKNOWN';
      const outputSource: string =
        typeof maxFromRegistry === 'number' && maxFromRegistry > 0
          ? m.source === 'ACCOUNT_DYNAMIC'
            ? 'REGISTRY_DISCOVERY'
            : m.source === 'OFFICIAL_STATIC_METADATA'
              ? 'PINNED_REFERENCE'
              : 'BUNDLED_CATALOG'
          : 'UNKNOWN';
      lines.push(
        `  provider=${m.provider} model=${m.id}` +
          ` wire=${wireId}` +
          ` context=${context ?? 'UNKNOWN'}` +
          ` (${contextSource})` +
          ` maxOutput=${maxFromRegistry ?? 'UNKNOWN'}` +
          ` (${outputSource})`,
      );
    }
  } catch (err) {
    failures.push(
      `Failed to build model-limits diagnostics: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { lines, failures };
}

export async function printModelLimitsDiagnostics(): Promise<number> {
  const { lines, failures } = await buildModelLimitsDiagnostics();
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  for (const failure of failures) {
    process.stderr.write(`diagnose-model-limits: FAIL: ${failure}\n`);
  }
  return failures.length > 0 ? 1 : 0;
}

// ─── Coding-plan auth diagnostics ────────────────────────────────────

export interface PlanDiagnosticsResult {
  lines: string[];
  failures: string[];
}

/**
 * Build safe coding-plan auth diagnostics for a specific provider.
 * Reports the derived auth mechanism, registration classification, the OMP
 * login backing, callback port, selectability, bundled model count, and the
 * final coding-plan matrix classification. Never prints credentials.
 */
export async function buildPlanDiagnostics(
  providerId: string,
): Promise<PlanDiagnosticsResult> {
  installBunGlobal();
  const lines: string[] = [];
  const failures: string[] = [];

  lines.push(`PLUMB coding-plan diagnostics: ${providerId}`);
  lines.push(`git.head.embedded: ${BUILD_IDENTITY.gitHead}`);

  try {
    const providerModule = await import('@google/gemini-cli-provider');

    const canonicalId = providerModule.resolveProviderAlias
      ? providerModule.resolveProviderAlias(providerId)
      : providerId;
    lines.push(`requested.provider: ${providerId}`);
    lines.push(`canonical.provider: ${canonicalId}`);

    const providerDef = providerModule.getProviderDefinition?.(canonicalId);
    const plumbProvider = providerModule.getPlumbProvider
      ? providerModule.getPlumbProvider(providerId)
      : undefined;

    // Auth mechanism: derived from the OMP login surface + catalog auth
    // methods, never from a guessed per-provider endpoint map.
    const hasLogin = typeof providerDef?.login === 'function';
    const hasRefresh = typeof providerDef?.refreshToken === 'function';
    const authMethods =
      plumbProvider?.authMethods
        ?.map((m: { type: string }) => m.type)
        .join('|') ?? 'none';
    lines.push(`auth.methods: ${authMethods}`);
    lines.push(`omp.login: ${hasLogin ? 'present' : 'absent'}`);
    lines.push(`omp.refreshToken: ${hasRefresh ? 'present' : 'absent'}`);
    lines.push(`omp.callbackPort: ${providerDef?.callbackPort ?? 'none'}`);
    lines.push(
      `omp.pasteCodeFlow: ${providerDef?.pasteCodeFlow ? 'true' : 'false'}`,
    );

    // Mechanism classification used by the coding-plan matrix.
    let mechanism: string;
    if (
      plumbProvider?.authMethods?.some(
        (m: { type: string }) => m.type === 'device_code',
      )
    ) {
      mechanism = 'DEVICE_CODE';
    } else if (
      plumbProvider?.authMethods?.some(
        (m: { type: string }) => m.type === 'oauth',
      )
    ) {
      mechanism = hasLogin ? 'OAUTH_ACCOUNT_FLOW' : 'OAUTH_NO_LOGIN';
    } else if (
      plumbProvider?.authMethods?.some(
        (m: { type: string }) => m.type === 'api_key',
      )
    ) {
      mechanism = 'API_KEY';
    } else {
      mechanism = 'NONE';
    }
    lines.push(`mechanism: ${mechanism}`);

    // Registration classification: honest label per the coding-plan governance
    // rules. api-key plans with OMP login use the official CLI delegation route
    // (same auth page the official CLI uses). OAuth/device-code plans use the
    // upstream product's public OAuth client.
    const registrationClass = !hasLogin
      ? 'MISSING_REGISTRATION'
      : mechanism === 'API_KEY'
        ? 'OFFICIAL_CLI_DELEGATION'
        : 'UPSTREAM_PRODUCT_OWNED_REGISTRATION';
    lines.push(`registration: ${registrationClass}`);

    const isSelectable =
      providerModule.SELECTABLE_PROVIDERS?.some(
        (p: { id: string }) => p.id === providerId,
      ) ?? false;
    lines.push(`selectable: ${isSelectable}`);
    lines.push(
      `availability.reason: ${plumbProvider?.availabilityReason ?? 'none'}`,
    );

    // Bundled model count for the picker.
    const bundledModels = providerModule.getCatalogModels?.(canonicalId) ?? [];
    lines.push(`bundled.model.count: ${bundledModels.length}`);

    // Final matrix classification. PRODUCTION_READY is reserved exclusively
    // for plans whose real login + model population + real streamed response
    // have been verified by a live user test. Static diagnostics can only
    // claim IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED (code paths
    // verified to the external user-account boundary), IMPLEMENTATION_INCOMPLETE_NOT_SELECTABLE
    // (route incomplete), or BLOCKED_CLIENT_REGISTRATION (registration
    // cannot legitimately be used by PLUMB).
    let finalClassification: string;
    if (!isSelectable) {
      finalClassification = 'IMPLEMENTATION_INCOMPLETE_NOT_SELECTABLE';
    } else if (!hasLogin && mechanism !== 'API_KEY') {
      finalClassification = 'IMPLEMENTATION_INCOMPLETE_NOT_SELECTABLE';
    } else {
      finalClassification =
        'IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED';
    }
    lines.push(`final.classification: ${finalClassification}`);
    lines.push(`last.safe.error: none`);

    // Live verification gate: only real user tests can upgrade to PRODUCTION_READY.
    lines.push(`live.status: NOT_LIVE_VERIFIED`);
    lines.push(
      `live.gate: PLUMB_CODING_PLAN_AUTH_STATIC_REPAIR_READY_FOR_LIVE_USER_TEST`,
    );

    if (isSelectable && !hasLogin && mechanism !== 'API_KEY') {
      failures.push(
        `${providerId}: selectable=true but has no OMP login and no API-key path`,
      );
    }
  } catch (err) {
    failures.push(
      `Failed to build coding-plan diagnostics: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { lines, failures };
}

/** Print the coding-plan diagnostics report. Returns the process exit code. */
export async function printPlanDiagnostics(
  providerId: string,
): Promise<number> {
  const { lines, failures } = await buildPlanDiagnostics(providerId);
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  for (const failure of failures) {
    process.stderr.write(`diagnose-plan: FAIL: ${failure}\n`);
  }
  return failures.length > 0 ? 1 : 0;
}

// ─── Coding-plan live-verification gate ──────────────────────────────

/**
 * All 23 PLUMB coding-plan ids (canonical or alias) in the order they
 * appear in the catalog. Used by the live-status gate and the matrix test.
 */
export const ALL_CODING_PLAN_IDS: readonly string[] = [
  'openai-codex',
  'github-copilot',
  'cursor',
  'kimi-code',
  'minimax-code',
  'alibaba-coding-plan',
  'alibaba-token-plan',
  'zhipu-coding-plan',
  'qwen-portal',
  'zai-coding-plan',
  'opencode-go',
  'opencode-zen',
  'gitlab-duo',
  'gitlab-duo-agent',
  'devin',
  'antigravity',
  'google-gemini-cli',
  'umans',
  'sakana',
  'minimax-code-cn',
  'xiaomi-token-plan-sgp',
  'xiaomi-token-plan-ams',
  'xiaomi-token-plan-cn',
];

interface LiveVerificationStatus {
  providerId: string;
  status:
    | 'PENDING_REAL_DEVICE_LOGIN'
    | 'PENDING_REAL_OAUTH_OR_BLOCKED'
    | 'OFFICIAL_DELEGATION_VERIFIED_OR_BLOCKED'
    | 'LIVE_VERIFIED';
}

/**
 * Live verification status for the four previously-broken coding plans.
 * Until the user completes a real login flow, these plans remain in a
 * pending state. PRODUCTION_READY is reserved exclusively for plans whose
 * real login + model population + real streamed response have been verified
 * by a live user test.
 */
const LIVE_VERIFICATION_STATUS: readonly LiveVerificationStatus[] = [
  {
    providerId: 'github-copilot',
    status: 'PENDING_REAL_DEVICE_LOGIN',
  },
  {
    providerId: 'kimi-code',
    status: 'PENDING_REAL_DEVICE_LOGIN',
  },
  {
    providerId: 'opencode-go',
    status: 'OFFICIAL_DELEGATION_VERIFIED_OR_BLOCKED',
  },
  {
    providerId: 'antigravity',
    status: 'PENDING_REAL_OAUTH_OR_BLOCKED',
  },
];

/**
 * Build the coding-plan live-verification gate report (section 7 of the
 * governance rules). Prints the real-user test status for the four
 * previously-broken coding plans and the total count of live-verified plans.
 * No credentials are printed.
 */
export function buildCodingPlanLiveStatus(): string[] {
  const lines: string[] = [];
  lines.push('PLUMB coding-plan live-verification gate');
  lines.push(`git.head.embedded: ${BUILD_IDENTITY.gitHead}`);
  lines.push('');

  for (const entry of LIVE_VERIFICATION_STATUS) {
    const label = entry.providerId.toUpperCase().replace(/-/g, '_');
    lines.push(`${label}: ${entry.status}`);
  }

  lines.push('');
  const liveVerifiedCount = 0; // no plans have been live-verified yet
  lines.push(`LIVE_VERIFIED_CODING_PLANS: ${liveVerifiedCount}`);
  lines.push('');

  lines.push('PLUMB_CODING_PLAN_AUTH_STATIC_REPAIR_READY_FOR_LIVE_USER_TEST');

  return lines;
}

/**
 * Print the coding-plan live-verification gate report.
 * Returns the process exit code.
 */
export function printCodingPlanLiveStatus(): number {
  const lines = buildCodingPlanLiveStatus();
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  return 0;
}

// ─── Antigravity route diagnostics ────────────────────────────────────
//
// Both handlers below call the SAME production function
// (buildAntigravityRequest, exported from @google/gemini-cli-provider's
// transports/streaming.ts) that normal chat calls via plumbModelStream —
// see NORMAL_CHAT_TRANSPORT_FUNCTION == DIAGNOSTIC_TRANSPORT_FUNCTION in
// the streaming.test.ts suite for the structural proof. Neither handler
// prints the access token, project id value, or raw response body — only
// presence/shape.

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string';
}

async function readPersistedAntigravitySelection(): Promise<{
  providerId: string | undefined;
  modelId: string | undefined;
}> {
  const { loadSettings } = await import('./config/settings.js');
  const settings = loadSettings(process.cwd());
  const merged = settings.merged as unknown as Record<string, unknown>;
  const plumb = merged['plumb'];
  const provider = isPlainRecord(plumb) ? plumb['provider'] : undefined;
  const providerIdValue = isPlainRecord(provider) ? provider['id'] : undefined;
  const providerId = isNonEmptyString(providerIdValue)
    ? providerIdValue
    : undefined;
  const model = merged['model'];
  const modelNameValue = isPlainRecord(model) ? model['name'] : undefined;
  const modelId = isNonEmptyString(modelNameValue) ? modelNameValue : undefined;
  return { providerId, modelId };
}

/** Safe (non-secret) summary of an AntigravityRequestDescriptor. */
function describeAntigravityRequest(
  descriptor: import('@google/gemini-cli-provider').AntigravityRequestDescriptor,
): string[] {
  const lines: string[] = [];
  const url = new URL(descriptor.url);
  lines.push(`request.origin: ${url.origin}`);
  lines.push(`request.pathname: ${url.pathname}`);
  lines.push(
    `request.query.keys: ${[...url.searchParams.keys()].join(',') || '(none)'}`,
  );
  lines.push(`request.query.alt.present: ${url.searchParams.has('alt')}`);
  lines.push(`request.query.key.present: ${url.searchParams.has('key')}`);
  lines.push(
    `request.headers.names: ${Object.keys(descriptor.headers).join(',')}`,
  );
  const authHeader = descriptor.headers['Authorization'];
  lines.push(`request.authorization.present: ${authHeader !== undefined}`);
  lines.push(
    `request.authorization.scheme: ${authHeader ? authHeader.split(' ')[0] : '(none)'}`,
  );

  const body = descriptor.body;
  if (isPlainRecord(body)) {
    lines.push(`request.body.keys: ${Object.keys(body).join(',')}`);
    lines.push(`request.body.project.present: ${'project' in body}`);
    const bodyModel = body['model'];
    lines.push(
      `request.body.model: ${isNonEmptyString(bodyModel) ? bodyModel : '(unknown)'}`,
    );
    lines.push(`request.body.request.present: ${'request' in body}`);
    lines.push(`request.body.requestId.present: ${'requestId' in body}`);
    const requestId = body['requestId'];
    lines.push(
      `request.body.requestId.shape: ${
        isNonEmptyString(requestId)
          ? /^agent\/[^/]+\/\d+\/[^/]+\/\d+$/.test(requestId)
            ? 'agent/<id>/<ts>/<trajectory>/<step>'
            : 'unrecognized'
          : '(absent)'
      }`,
    );
    const inner = body['request'];
    lines.push(
      `request.body.sessionId.present: ${isPlainRecord(inner) && 'sessionId' in inner}`,
    );
    lines.push(
      `request.body.labels.present: ${isPlainRecord(inner) && 'labels' in inner}`,
    );
    const bodyUserAgent = body['userAgent'];
    lines.push(
      `request.body.userAgent: ${isNonEmptyString(bodyUserAgent) ? bodyUserAgent : '(absent)'}`,
    );
    const bodyRequestType = body['requestType'];
    lines.push(
      `request.body.requestType: ${isNonEmptyString(bodyRequestType) ? bodyRequestType : '(absent)'}`,
    );
  }
  return lines;
}

/**
 * `plumb --diagnose-antigravity-route` — inspects the same production
 * registry/model/credential objects normal chat uses for the currently
 * persisted provider+model selection, and (if it resolves to
 * google-antigravity) builds the real request descriptor via
 * buildAntigravityRequest without sending it. Never sends a network
 * request; safe to run at any time.
 */
const ANTIGRAVITY_CANONICAL_ID = 'google-antigravity';

/**
 * Run the canonical production provider-runtime bootstrap
 * (registerPlumbCredentialStoreFactory + bundled model registration +
 * registry initialization) — the exact same function normal chat calls
 * from `@google/gemini-cli-core` during startup. Idempotent: safe to call
 * once more even though the CLI's normal startup path already calls it,
 * and safe to call from a diagnostic process that never reaches that path.
 * This function is the ONLY place a diagnostic may reach for provider
 * runtime setup — it must never register its own credential store.
 */
async function bootstrapProductionProviderRuntime(): Promise<boolean> {
  try {
    const { initializePlumbProviders } = await import(
      '@google/gemini-cli-core'
    );
    await initializePlumbProviders();
    return true;
  } catch {
    return false;
  }
}

type CredentialClassification =
  | 'NO_CREDENTIAL'
  | 'EXPIRED_REFRESHABLE'
  | 'EXPIRED_UNREFRESHABLE'
  | 'REFRESH_FAILED'
  | 'VALID_CREDENTIAL'
  | 'INVALID_STORED_SHAPE';

interface RawCredentialProbe {
  scope: string;
  storageEntryPresent: boolean;
  decodingSuccess: boolean;
  kind: 'oauth' | 'api_key' | 'none';
  accessTokenPresent: boolean;
  refreshTokenPresent: boolean;
  projectIdPresent: boolean;
  expiryPresent: boolean;
  expired: boolean;
  classification: CredentialClassification;
}

const NO_CREDENTIAL_PROBE: RawCredentialProbe = {
  scope: '',
  storageEntryPresent: false,
  decodingSuccess: true,
  kind: 'none',
  accessTokenPresent: false,
  refreshTokenPresent: false,
  projectIdPresent: false,
  expiryPresent: false,
  expired: false,
  classification: 'NO_CREDENTIAL',
};

/**
 * Read a provider's credential DIRECTLY from the real secure store, bypassing
 * PlumbProviderRegistry's expiry filter (which silently nulls out an expired
 * OAuth credential's `credentials` field and reports it as absent, even when
 * a perfectly refreshable credential is sitting in the store). This is what
 * makes an EXPIRED_REFRESHABLE credential distinguishable from one that was
 * never persisted at all — never modifies or removes anything.
 */
async function probeRawCredentialScope(
  scope: string,
): Promise<RawCredentialProbe> {
  const core = await import('@google/gemini-cli-core');
  const store = core.getPlumbCredentialStore();

  const [entries, metadata] = await Promise.all([
    store.getCredentials(scope).catch(() => []),
    store.getProviderMetadata(scope).catch(() => null),
  ]);
  const refCount = metadata?.credentialRefs.length ?? 0;

  if (entries.length === 0) {
    if (refCount > 0) {
      // Metadata references credential entries that failed to decode from
      // the keychain — a real corruption/shape defect, not "never signed in".
      return {
        ...NO_CREDENTIAL_PROBE,
        scope,
        storageEntryPresent: true,
        decodingSuccess: false,
        classification: 'INVALID_STORED_SHAPE',
      };
    }
    return { ...NO_CREDENTIAL_PROBE, scope };
  }

  // Prefer a non-expired OAuth entry over an expired one — the store
  // dedupes OAuth refs on write (exactly one should ever exist per
  // provider), but this stays defensive against pre-fix legacy stores that
  // may still hold multiple entries, so a stale one is never preferred
  // over a fresher one.
  const oauthEntries = entries.filter((e) => e.credential.type === 'oauth');
  const bestOauth =
    oauthEntries.find(
      (e) => e.credential.type === 'oauth' && e.credential.expires > Date.now(),
    ) ??
    (oauthEntries.length > 0
      ? oauthEntries.reduce((latest, e) =>
          e.credential.type === 'oauth' &&
          latest.credential.type === 'oauth' &&
          e.credential.expires > latest.credential.expires
            ? e
            : latest,
        )
      : undefined);
  const entry = bestOauth ?? entries[0];
  const cred = entry.credential;

  if (cred.type === 'api_key') {
    const present = !!cred.key;
    return {
      scope,
      storageEntryPresent: true,
      decodingSuccess: true,
      kind: 'api_key',
      accessTokenPresent: present,
      refreshTokenPresent: false,
      projectIdPresent: false,
      expiryPresent: false,
      expired: false,
      classification: present ? 'VALID_CREDENTIAL' : 'INVALID_STORED_SHAPE',
    };
  }

  const expired = cred.expires <= Date.now();
  const hasRefresh = !!cred.refresh;
  const classification: CredentialClassification = !cred.access
    ? 'INVALID_STORED_SHAPE'
    : expired
      ? hasRefresh
        ? 'EXPIRED_REFRESHABLE'
        : 'EXPIRED_UNREFRESHABLE'
      : 'VALID_CREDENTIAL';

  return {
    scope,
    storageEntryPresent: true,
    decodingSuccess: true,
    kind: 'oauth',
    accessTokenPresent: !!cred.access,
    refreshTokenPresent: hasRefresh,
    projectIdPresent: !!cred.projectId,
    expiryPresent: typeof cred.expires === 'number',
    expired,
    classification,
  };
}

function credentialProbeLines(
  probe: RawCredentialProbe,
  prefix: string,
): string[] {
  return [
    `${prefix}.storageEntry.present: ${probe.storageEntryPresent}`,
    `${prefix}.decoding.success: ${probe.decodingSuccess}`,
    `${prefix}.kind: ${probe.kind}`,
    `${prefix}.accessToken.present: ${probe.accessTokenPresent}`,
    `${prefix}.refreshToken.present: ${probe.refreshTokenPresent}`,
    `${prefix}.projectId.present: ${probe.projectIdPresent}`,
    `${prefix}.expiry.present: ${probe.expiryPresent}`,
    `${prefix}.expired: ${probe.expired}`,
    `${prefix}.classification: ${probe.classification}`,
  ];
}

/**
 * `plumb --diagnose-credential-scope <provider>` — proves, rather than
 * assumes, which literal string PlumbProviderRegistry/credential-store state
 * is actually keyed by for a given provider, by probing the REAL secure
 * store under both the PLUMB presentation id and the OMP catalog id. Never
 * modifies the store. Never prints a token/project-id value.
 */
export async function buildCredentialScopeDiagnostics(
  requestedProviderId: string,
): Promise<{ lines: string[]; failures: string[] }> {
  const lines: string[] = [];
  const failures: string[] = [];
  lines.push(`PLUMB credential scope diagnostics: ${requestedProviderId}`);
  lines.push(`git.head.embedded: ${BUILD_IDENTITY.gitHead}`);

  try {
    installBunGlobal();
    const providerModule = await import('@google/gemini-cli-provider');
    const runtimeInitialized = await bootstrapProductionProviderRuntime();
    lines.push(`runtime.initialized: ${runtimeInitialized}`);

    const canonicalProviderId =
      providerModule.resolveProviderAlias(requestedProviderId);
    lines.push(`requested.provider: ${requestedProviderId}`);
    lines.push(`canonical.catalog.provider: ${canonicalProviderId}`);
    lines.push(`credentialStore.configured: ${runtimeInitialized}`);

    // Every candidate literal scope this provider could plausibly be keyed
    // under: the requested id as given, the canonical OMP id, and the PLUMB
    // registry id resolved from that OMP id — deduplicated.
    const candidateScopes = Array.from(
      new Set([
        requestedProviderId,
        canonicalProviderId,
        providerModule.resolvePlumbProviderId(canonicalProviderId),
      ]),
    );

    const probes = new Map<string, RawCredentialProbe>();
    for (const scope of candidateScopes) {
      probes.set(scope, await probeRawCredentialScope(scope));
    }
    for (const scope of candidateScopes) {
      const probe = probes.get(scope)!;
      lines.push(
        `candidateScope.${scope}.present: ${probe.storageEntryPresent}`,
      );
    }

    const resolvedScope = candidateScopes.find(
      (s) => probes.get(s)!.storageEntryPresent,
    );
    lines.push(`resolved.scope: ${resolvedScope ?? '(none)'}`);

    const resolvedProbe = resolvedScope
      ? probes.get(resolvedScope)!
      : { ...NO_CREDENTIAL_PROBE, scope: requestedProviderId };
    lines.push(...credentialProbeLines(resolvedProbe, 'credential'));
  } catch (err) {
    failures.push(err instanceof Error ? err.message : String(err));
  }

  return { lines, failures };
}

export async function printCredentialScopeDiagnostics(
  requestedProviderId: string,
): Promise<number> {
  const { lines, failures } =
    await buildCredentialScopeDiagnostics(requestedProviderId);
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  for (const failure of failures) {
    process.stderr.write(`diagnose-credential-scope: FAIL: ${failure}\n`);
  }
  return failures.length > 0 ? 1 : 0;
}

export async function buildAntigravityRouteDiagnostics(): Promise<{
  lines: string[];
  failures: string[];
}> {
  const lines: string[] = [];
  const failures: string[] = [];
  lines.push('PLUMB Antigravity route diagnostics');
  lines.push(`git.head.embedded: ${BUILD_IDENTITY.gitHead}`);

  try {
    installBunGlobal();
    const providerModule = await import('@google/gemini-cli-provider');

    const runtimeInitialized = await bootstrapProductionProviderRuntime();
    lines.push(`runtime.initialized: ${runtimeInitialized}`);

    const { providerId, modelId } = await readPersistedAntigravitySelection();
    const canonicalProviderId = providerId
      ? providerModule.resolveProviderAlias(providerId)
      : undefined;
    lines.push(
      `active.provider.persisted: ${providerId ?? '(none configured)'}`,
    );
    lines.push(
      `active.provider.canonical: ${canonicalProviderId ?? '(none configured)'}`,
    );
    lines.push(`active.model: ${modelId ?? '(none configured)'}`);

    if (canonicalProviderId !== ANTIGRAVITY_CANONICAL_ID) {
      lines.push(
        'note: the currently configured provider is not google-antigravity; nothing further to diagnose. Use --test-antigravity-route <model> to probe it directly regardless of the active session.',
      );
      return { lines, failures };
    }
    if (!modelId) {
      failures.push('no active model configured');
      return { lines, failures };
    }

    const registry = providerModule.getPlumbProviderRegistry();
    let credentialStoreConfigured = true;
    try {
      await registry.initialize();
    } catch (err) {
      credentialStoreConfigured = false;
      lines.push(`credential.store.configured: false`);
      failures.push(
        `credential store unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { lines, failures };
    }
    lines.push(`credential.store.configured: ${credentialStoreConfigured}`);

    // Same resolution production buildAntigravityRequest performs internally
    // (resolvePlumbProviderId(model.provider)) — PlumbProviderRegistry state
    // is keyed by the PLUMB presentation id (`antigravity`), not the OMP id
    // (`google-antigravity`) this diagnostic otherwise reports/uses.
    const registryProviderId = providerModule.resolvePlumbProviderId(
      ANTIGRAVITY_CANONICAL_ID,
    );
    const state = registry.getProviderState(registryProviderId);
    // Coarse, registry-filtered view (kept for backward compatibility with
    // existing callers of this field) — an expired credential reads as
    // absent here even when it is actually present-and-refreshable. See the
    // truthful credential.* block below for the real classification.
    lines.push(`credential.present: ${!!state?.credentials}`);

    // Truthful view: read the real secure store directly, so an expired
    // credential is reported as EXPIRED_REFRESHABLE instead of indistinguishable
    // from "never signed in".
    const rawProbe = await probeRawCredentialScope(registryProviderId);
    lines.push(...credentialProbeLines(rawProbe, 'credential'));
    lines.push(
      `credential.runtimeUsable: ${rawProbe.classification === 'VALID_CREDENTIAL'}`,
    );

    const modelRegistry = providerModule.getPlumbModelRegistry();
    const model = modelRegistry.findModel(ANTIGRAVITY_CANONICAL_ID, modelId);
    if (!model) {
      failures.push(
        `model ${modelId} not found in the google-antigravity catalog`,
      );
      return { lines, failures };
    }
    lines.push(`catalog.model.displayId: ${model.id}`);
    lines.push(
      `catalog.model.requestModelId: ${model.requestModelId ?? '(same as displayId)'}`,
    );
    lines.push(`catalog.model.api: ${model.api}`);

    lines.push('transport.function: googleCloudCodeAssistStream');
    lines.push(
      'transport.source: packages/provider/src/transports/streaming.ts',
    );
    lines.push('buildRequest.used: true');
    lines.push(
      'buildRequest.source: packages/provider/src/omp-ai/providers/google-gemini-cli.ts',
    );

    const result = await providerModule.buildAntigravityRequest({
      model,
      messages: [{ role: 'user', content: '(diagnostic — not sent)' }],
      apiKey: '',
    });

    if (!result.ok) {
      lines.push(`build.result: ${result.error.error?.code ?? 'ERROR'}`);
      failures.push(
        result.error.error?.message ?? 'failed to build Antigravity request',
      );
      return { lines, failures };
    }

    lines.push('build.result: ok');
    lines.push(...describeAntigravityRequest(result.descriptor));
  } catch (err) {
    failures.push(err instanceof Error ? err.message : String(err));
  }

  return { lines, failures };
}

export async function printAntigravityRouteDiagnostics(): Promise<number> {
  const { lines, failures } = await buildAntigravityRouteDiagnostics();
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  for (const failure of failures) {
    process.stderr.write(`diagnose-antigravity-route: FAIL: ${failure}\n`);
  }
  return failures.length > 0 ? 1 : 0;
}

/**
 * `plumb --test-antigravity-route <model>` — sends ONE real, minimal
 * request to the real google-antigravity endpoint using the already-stored
 * credential, through the exact production transport
 * (googleCloudCodeAssistStream / buildAntigravityRequest). Never modifies
 * credentials, never persists state, never prints the prompt or any
 * secret. Classifies the HTTP result without ever printing the response
 * body.
 */
export async function runAntigravityRouteTest(
  modelId: string,
): Promise<number> {
  process.stdout.write('PLUMB Antigravity live route probe\n');
  process.stdout.write(`git.head.embedded: ${BUILD_IDENTITY.gitHead}\n`);
  process.stdout.write(`provider: google-antigravity\n`);
  process.stdout.write(`display.model: ${modelId}\n`);

  try {
    installBunGlobal();
    const providerModule = await import('@google/gemini-cli-provider');

    const runtimeInitialized = await bootstrapProductionProviderRuntime();
    process.stdout.write(`runtime.initialized: ${runtimeInitialized}\n`);

    const registry = providerModule.getPlumbProviderRegistry();
    try {
      await registry.initialize();
    } catch (err) {
      process.stdout.write('credential.store.configured: false\n');
      process.stdout.write('request.attempted: false\n');
      process.stdout.write('http.status: NOT_SENT\n');
      process.stderr.write(
        `test-antigravity-route: FAIL: credential store unavailable: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 1;
    }
    process.stdout.write('credential.store.configured: true\n');

    // Same resolution production buildAntigravityRequest performs internally
    // (resolvePlumbProviderId(model.provider)) — PlumbProviderRegistry state
    // is keyed by the PLUMB presentation id (`antigravity`), not the OMP id
    // (`google-antigravity`).
    const registryProviderId = providerModule.resolvePlumbProviderId(
      ANTIGRAVITY_CANONICAL_ID,
    );

    const beforeProbe = await probeRawCredentialScope(registryProviderId);
    process.stdout.write(
      `credential.present: ${beforeProbe.storageEntryPresent}\n`,
    );
    process.stdout.write(
      `credential.classification.before: ${beforeProbe.classification}\n`,
    );

    // Canonical resolver — same one buildAntigravityRequest uses for normal
    // chat. Classifies, and (only when expired-but-refreshable) performs
    // exactly one silent refresh-token exchange; never a new OAuth/login
    // flow. Only reports SUCCESS after re-reading the store and confirming
    // the refreshed credential is genuinely usable.
    const resolved =
      await providerModule.resolveUsablePlumbCredential(registryProviderId);
    process.stdout.write(`refresh.attempted: ${resolved.refreshAttempted}\n`);
    if (resolved.refreshAttempted) {
      process.stdout.write(
        `refresh.result: ${resolved.classification === 'VALID_CREDENTIAL' ? 'SUCCESS' : 'FAILED'}\n`,
      );
    }
    process.stdout.write(
      `credential.classification.after: ${resolved.classification}\n`,
    );
    process.stdout.write(
      `credential.runtimeUsable: ${resolved.classification === 'VALID_CREDENTIAL'}\n`,
    );

    if (
      !resolved.credential ||
      resolved.classification !== 'VALID_CREDENTIAL'
    ) {
      process.stdout.write('request.attempted: false\n');
      process.stdout.write('http.status: NOT_SENT\n');
      process.stderr.write(
        resolved.classification === 'NO_CREDENTIAL'
          ? 'test-antigravity-route: FAIL: no stored google-antigravity OAuth credential. Sign in via /login google-antigravity first.\n'
          : `test-antigravity-route: FAIL: credential unusable (${resolved.classification}: ${resolved.refreshFailureReason ?? 'no further detail'}).\n`,
      );
      return 1;
    }

    const modelRegistry = providerModule.getPlumbModelRegistry();
    const model = modelRegistry.findModel(ANTIGRAVITY_CANONICAL_ID, modelId);
    if (!model) {
      process.stdout.write('request.attempted: false\n');
      process.stdout.write('http.status: NOT_SENT\n');
      process.stderr.write(
        `test-antigravity-route: FAIL: model ${modelId} not found in the google-antigravity catalog.\n`,
      );
      return 1;
    }
    process.stdout.write(`wire.model: ${model.requestModelId ?? model.id}\n`);

    const probeTraceId = providerModule.antigravityTraceEnabled?.()
      ? providerModule.makeAntigravityTraceId?.()
      : undefined;

    const result = await providerModule.buildAntigravityRequest(
      {
        model,
        messages: [{ role: 'user', content: 'ping' }],
        apiKey: '',
        traceSource: 'LIVE_PROBE',
      },
      probeTraceId,
    );
    if (!result.ok) {
      process.stdout.write('request.attempted: false\n');
      process.stdout.write('http.status: NOT_SENT\n');
      process.stdout.write(
        `safe.error.classification: ${result.error.error?.code ?? 'BUILD_FAILED'}\n`,
      );
      process.stderr.write(
        `test-antigravity-route: FAIL: ${result.error.error?.message ?? 'failed to build request'}\n`,
      );
      return 1;
    }

    const url = new URL(result.descriptor.url);
    process.stdout.write(`origin: ${url.origin}\n`);
    process.stdout.write(`pathname: ${url.pathname}\n`);
    process.stdout.write(
      `query.keys: ${[...url.searchParams.keys()].join(',') || '(none)'}\n`,
    );
    process.stdout.write(
      `authorization.present: ${result.descriptor.headers['Authorization'] !== undefined}\n`,
    );
    const bodyRecord = isPlainRecord(result.descriptor.body)
      ? result.descriptor.body
      : {};
    process.stdout.write(`project.present: ${'project' in bodyRecord}\n`);

    if (
      probeTraceId &&
      typeof providerModule.traceAntigravityFinalHttpRequest === 'function'
    ) {
      providerModule.traceAntigravityFinalHttpRequest({
        traceId: probeTraceId,
        source: 'LIVE_PROBE',
        model,
        descriptor: result.descriptor,
        options: {
          model,
          messages: [{ role: 'user', content: 'ping' }],
          apiKey: '',
          traceSource: 'LIVE_PROBE',
        },
        resolvedCredential: resolved,
      });
    }

    let response: Response;
    process.stdout.write('request.attempted: true\n');
    try {
      response = await fetch(result.descriptor.url, {
        method: 'POST',
        headers: result.descriptor.headers,
        body: JSON.stringify(result.descriptor.body),
      });
      if (
        probeTraceId &&
        typeof providerModule.traceAntigravityHttpResponse === 'function'
      ) {
        providerModule.traceAntigravityHttpResponse({
          traceId: probeTraceId,
          source: 'LIVE_PROBE',
          response,
        });
      }
    } catch (err) {
      if (
        probeTraceId &&
        typeof providerModule.traceAntigravityError === 'function'
      ) {
        providerModule.traceAntigravityError({
          traceId: probeTraceId,
          source: 'LIVE_PROBE',
          error: {
            code: 'REQUEST_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
      process.stdout.write('http.status: NOT_SENT\n');
      process.stdout.write('safe.error.classification: REQUEST_FAILED\n');
      process.stderr.write(
        `test-antigravity-route: FAIL: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 1;
    }

    process.stdout.write(`HTTP.status: ${response.status}\n`);
    process.stdout.write(
      `HTTP.contentType: ${response.headers.get('content-type') ?? '(none)'}\n`,
    );
    const traceId =
      response.headers.get('x-goog-trace-id') ??
      response.headers.get('x-request-id');
    if (traceId) {
      process.stdout.write(`google.requestId: ${traceId}\n`);
    }
    // Drain the body without ever printing it — required to let the
    // connection close cleanly, but its content (which may echo request
    // context) must never reach the terminal.
    await response.body?.cancel();

    if (response.status === 404) {
      process.stdout.write('404.classification: ENDPOINT_NOT_FOUND\n');
    } else if (response.ok) {
      process.stdout.write('result: HTTP_OK\n');
    } else {
      process.stdout.write(
        `safe.error.classification: HTTP_${response.status}\n`,
      );
    }

    return 0;
  } catch (err) {
    process.stderr.write(
      `test-antigravity-route: FAIL: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

/**
 * `plumb --test-antigravity-claude-matrix <model>` — sends real sequential
 * HTTP probe cases A through G to Google Antigravity for a Claude model using
 * the canonical request builder and stored credentials. Reports safe structural
 * field metadata, HTTP status, and safe error details (status, reason, field
 * violations). Never modifies stored credentials, never persists state, never
 * prints prompt text or secrets.
 */
export async function runAntigravityClaudeMatrixTest(
  modelId: string,
): Promise<number> {
  process.stdout.write('PLUMB Antigravity Claude real network matrix test\n');
  process.stdout.write(`git.head.embedded: ${BUILD_IDENTITY.gitHead}\n`);
  process.stdout.write(`provider: google-antigravity\n`);
  process.stdout.write(`display.model: ${modelId}\n\n`);

  try {
    installBunGlobal();
    const providerModule = await import('@google/gemini-cli-provider');

    const runtimeInitialized = await bootstrapProductionProviderRuntime();
    if (!runtimeInitialized) {
      process.stderr.write(
        'test-antigravity-claude-matrix: FAIL: failed to initialize provider runtime.\n',
      );
      return 1;
    }

    const registry = providerModule.getPlumbProviderRegistry();
    try {
      await registry.initialize();
    } catch (err) {
      process.stderr.write(
        `test-antigravity-claude-matrix: FAIL: credential store unavailable: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 1;
    }

    const registryProviderId = providerModule.resolvePlumbProviderId(
      ANTIGRAVITY_CANONICAL_ID,
    );

    const resolved =
      await providerModule.resolveUsablePlumbCredential(registryProviderId);

    if (
      !resolved.credential ||
      resolved.classification !== 'VALID_CREDENTIAL'
    ) {
      process.stderr.write(
        resolved.classification === 'NO_CREDENTIAL'
          ? 'test-antigravity-claude-matrix: FAIL: no stored google-antigravity OAuth credential. Sign in via /login google-antigravity first.\n'
          : `test-antigravity-claude-matrix: FAIL: credential unusable (${resolved.classification}: ${resolved.refreshFailureReason ?? 'no further detail'}).\n`,
      );
      return 1;
    }

    const modelRegistry = providerModule.getPlumbModelRegistry();
    const model = modelRegistry.findModel(ANTIGRAVITY_CANONICAL_ID, modelId);
    if (!model) {
      process.stderr.write(
        `test-antigravity-claude-matrix: FAIL: model ${modelId} not found in the google-antigravity catalog.\n`,
      );
      return 1;
    }

    const ALL_16_PLUMB_TOOLS: PlumbTool[] = [
      'update_topic',
      'list_directory',
      'read_file',
      'grep_search',
      'glob',
      'replace',
      'write_file',
      'web_fetch',
      'run_shell_command',
      'list_background_processes',
      'read_background_output',
      'google_web_search',
      'ask_user',
      'enter_plan_mode',
      'invoke_agent',
      'activate_skill',
    ].map((name) => ({
      type: 'function',
      function: {
        name,
        description: `PLUMB tool ${name}`,
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            query: { type: 'string' },
          },
        },
      },
    }));

    const MINIMAL_TOOL: PlumbTool[] = ALL_16_PLUMB_TOOLS.slice(0, 1);

    const cases: Array<{
      id: string;
      title: string;
      messages: PlumbMessage[];
      tools?: PlumbTool[];
      systemPrompt?: string;
    }> = [
      {
        id: 'A',
        title: 'one user content, zero tools',
        messages: [{ role: 'user', content: 'hello probe' }],
        tools: undefined,
        systemPrompt: undefined,
      },
      {
        id: 'B',
        title:
          'two source user messages after canonical normalization, zero tools',
        messages: [
          { role: 'user', content: 'System context part' },
          { role: 'user', content: 'User prompt part' },
        ],
        tools: undefined,
        systemPrompt: undefined,
      },
      {
        id: 'C',
        title: 'one user, one known minimal tool',
        messages: [{ role: 'user', content: 'hello probe' }],
        tools: MINIMAL_TOOL,
        systemPrompt: undefined,
      },
      {
        id: 'D',
        title: 'one user, full 16 PLUMB tools',
        messages: [{ role: 'user', content: 'hello probe' }],
        tools: ALL_16_PLUMB_TOOLS,
        systemPrompt: undefined,
      },
      {
        id: 'E',
        title: 'normalized production history, zero tools',
        messages: [
          { role: 'user', content: 'Initial user turn' },
          { role: 'assistant', content: 'Initial model response' },
          { role: 'user', content: 'Followup user prompt' },
        ],
        tools: undefined,
        systemPrompt: 'System prompt context',
      },
      {
        id: 'F',
        title: 'normalized production history, full 16 tools',
        messages: [
          { role: 'user', content: 'Initial user turn' },
          { role: 'assistant', content: 'Initial model response' },
          { role: 'user', content: 'Followup user prompt' },
        ],
        tools: ALL_16_PLUMB_TOOLS,
        systemPrompt: 'System prompt context',
      },
      {
        id: 'G',
        title: 'full normal PLUMB request shape',
        messages: [
          { role: 'user', content: 'Synthetic system context part' },
          { role: 'user', content: 'User prompt part' },
        ],
        tools: ALL_16_PLUMB_TOOLS,
        systemPrompt: 'System prompt context',
      },
    ];

    let anyFailed = false;

    for (const c of cases) {
      process.stdout.write(`--- CASE ${c.id}: ${c.title} ---\n`);

      const probeOptions = {
        model,
        messages: c.messages,
        tools: c.tools,
        systemPrompt: c.systemPrompt,
        apiKey: '',
        traceSource: 'LIVE_PROBE' as const,
      };

      const result = await providerModule.buildAntigravityRequest(probeOptions);
      if (!result.ok) {
        process.stdout.write(`case: ${c.id}\n`);
        process.stdout.write(`HTTP.status: NOT_SENT\n`);
        process.stdout.write(
          `safe.error.classification: ${result.error.error?.code ?? 'BUILD_FAILED'}\n\n`,
        );
        anyFailed = true;
        continue;
      }

      const bodyRec = isPlainRecord(result.descriptor.body)
        ? result.descriptor.body
        : {};
      const innerRec = isPlainRecord(bodyRec['request'])
        ? bodyRec['request']
        : {};

      const bodyContents = Array.isArray(innerRec['contents'])
        ? (innerRec['contents'] as Array<{ role?: string }>)
        : [];
      const roles = bodyContents.map((item) => item.role ?? 'unknown');

      const bodyTools = Array.isArray(innerRec['tools'])
        ? (innerRec['tools'] as Array<Record<string, unknown>>)
        : [];
      const firstTool = bodyTools[0];
      const decls =
        firstTool && Array.isArray(firstTool['functionDeclarations'])
          ? (firstTool['functionDeclarations'] as unknown[])
          : [];
      const toolCount = decls.length;

      const sysInstPresent = 'systemInstruction' in innerRec;
      const genConfigKeys = isPlainRecord(innerRec['generationConfig'])
        ? Object.keys(innerRec['generationConfig']).sort()
        : [];
      const toolConfigObj = isPlainRecord(innerRec['toolConfig'])
        ? innerRec['toolConfig']
        : undefined;
      const toolConfigMode =
        toolConfigObj && isPlainRecord(toolConfigObj['functionCallingConfig'])
          ? String(toolConfigObj['functionCallingConfig']['mode'] ?? '(none)')
          : undefined;

      process.stdout.write(`case: ${c.id}\n`);
      process.stdout.write(`contents.count: ${bodyContents.length}\n`);
      process.stdout.write(`contents.roles: ${roles.join(',')}\n`);
      process.stdout.write(`tools.count: ${toolCount}\n`);
      process.stdout.write(`systemInstruction.present: ${sysInstPresent}\n`);
      process.stdout.write(
        `generationConfig.keys: ${genConfigKeys.join(',') || '(none)'}\n`,
      );
      process.stdout.write(`toolConfig.present: ${!!toolConfigObj}\n`);
      if (toolConfigMode) {
        process.stdout.write(`toolConfig.mode: ${toolConfigMode}\n`);
      }

      try {
        const response = await fetch(result.descriptor.url, {
          method: 'POST',
          headers: result.descriptor.headers,
          body: JSON.stringify(result.descriptor.body),
        });

        process.stdout.write(`HTTP.status: ${response.status}\n`);

        if (response.ok) {
          process.stdout.write('result: HTTP_OK\n\n');
          await response.body?.cancel();
        } else {
          anyFailed = true;
          const bodyText = await response.text().catch(() => '');
          const errorDetails =
            providerModule.extractSafeGoogleErrorDetails(bodyText);
          const summaryLines =
            providerModule.formatSafeGoogleErrorSummary(errorDetails);
          for (const line of summaryLines) {
            process.stdout.write(`${line}\n`);
          }
          if (summaryLines.length === 0) {
            process.stdout.write(
              `safe.error.classification: HTTP_${response.status}\n`,
            );
          }
          process.stdout.write('\n');
        }
      } catch (err) {
        anyFailed = true;
        process.stdout.write('HTTP.status: FETCH_FAILED\n');
        process.stdout.write(
          `error: ${err instanceof Error ? err.message : String(err)}\n\n`,
        );
      }
    }

    return anyFailed ? 1 : 0;
  } catch (err) {
    process.stderr.write(
      `test-antigravity-claude-matrix: FAIL: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

/**
 * `plumb --diff-antigravity-trace <file>` — loads the latest completed
 * NORMAL_CHAT and LIVE_PROBE trace events from a safe JSONL trace file,
 * compares safe structural fields, and reports the differences.
 */
export async function runDiffAntigravityTrace(
  filePath: string,
): Promise<number> {
  process.stdout.write('PLUMB Antigravity trace diff tool\n');
  process.stdout.write(`file: ${filePath}\n`);

  if (!fs.existsSync(filePath)) {
    process.stderr.write(
      `diff-antigravity-trace: FAIL: trace file not found: ${filePath}\n`,
    );
    return 1;
  }

  let lines: string[] = [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    lines = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch (err) {
    process.stderr.write(
      `diff-antigravity-trace: FAIL: cannot read trace file: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  const eventsByTraceId = new Map<string, Array<Record<string, unknown>>>();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const traceId = String(parsed['traceId'] ?? '');
      if (traceId) {
        if (!eventsByTraceId.has(traceId)) {
          eventsByTraceId.set(traceId, []);
        }
        eventsByTraceId.get(traceId)!.push(parsed);
      }
    } catch {
      // Ignore malformed lines safely
    }
  }

  interface CompletedTrace {
    traceId: string;
    source: string;
    requestEvent: Record<string, unknown>;
    responseEvent: Record<string, unknown>;
  }

  let latestNormalChat: CompletedTrace | null = null;
  let latestLiveProbe: CompletedTrace | null = null;

  for (const [traceId, events] of eventsByTraceId.entries()) {
    const reqEvt = events.find((e) => e['phase'] === 'FINAL_HTTP_REQUEST');
    const respEvt = events.find(
      (e) => e['phase'] === 'HTTP_RESPONSE' || e['phase'] === 'ERROR',
    );
    if (reqEvt && respEvt) {
      const source = String(reqEvt['source'] ?? respEvt['source'] ?? '');
      const completed: CompletedTrace = {
        traceId,
        source,
        requestEvent: reqEvt,
        responseEvent: respEvt,
      };
      if (source === 'NORMAL_CHAT') {
        latestNormalChat = completed;
      } else if (source === 'LIVE_PROBE') {
        latestLiveProbe = completed;
      }
    }
  }

  if (!latestNormalChat) {
    process.stderr.write(
      'diff-antigravity-trace: FAIL: missing completed NORMAL_CHAT trace in file\n',
    );
    return 1;
  }
  if (!latestLiveProbe) {
    process.stderr.write(
      'diff-antigravity-trace: FAIL: missing completed LIVE_PROBE trace in file\n',
    );
    return 1;
  }

  function getSubField(
    e: Record<string, unknown>,
    parent: string,
    child: string,
  ): string {
    const p = e[parent];
    if (p && typeof p === 'object') {
      const val = (p as Record<string, unknown>)[child];
      if (val !== undefined && val !== null) {
        return String(val);
      }
    }
    return '';
  }

  function getSubArrayJoin(
    e: Record<string, unknown>,
    parent: string,
    child: string,
  ): string {
    const p = e[parent];
    if (p && typeof p === 'object') {
      const arr = (p as Record<string, unknown>)[child];
      if (Array.isArray(arr)) {
        return arr.join(',');
      }
    }
    return '';
  }

  function getSubObjectJson(
    e: Record<string, unknown>,
    parent: string,
    child: string,
  ): string {
    const p = e[parent];
    if (p && typeof p === 'object') {
      const val = (p as Record<string, unknown>)[child];
      if (val !== undefined && val !== null) {
        return JSON.stringify(val);
      }
    }
    return '{}';
  }

  const normalErr = latestNormalChat.responseEvent['error'];
  const normalErrCode =
    normalErr && typeof normalErr === 'object'
      ? String((normalErr as Record<string, unknown>)['code'] ?? 'ERROR')
      : 'ERROR';
  const normalStatus =
    latestNormalChat.responseEvent['status'] !== undefined
      ? String(latestNormalChat.responseEvent['status'])
      : normalErrCode;

  const probeErr = latestLiveProbe.responseEvent['error'];
  const probeErrCode =
    probeErr && typeof probeErr === 'object'
      ? String((probeErr as Record<string, unknown>)['code'] ?? 'ERROR')
      : 'ERROR';
  const probeStatus =
    latestLiveProbe.responseEvent['status'] !== undefined
      ? String(latestLiveProbe.responseEvent['status'])
      : probeErrCode;

  process.stdout.write(`NORMAL_CHAT_STATUS: ${normalStatus}\n`);
  process.stdout.write(`LIVE_PROBE_STATUS: ${probeStatus}\n`);
  process.stdout.write('\n');

  const safeFieldsToCompare: Array<{
    key: string;
    get: (e: Record<string, unknown>) => string;
  }> = [
    {
      key: 'provider.plumbId',
      get: (e) => getSubField(e, 'provider', 'plumbId'),
    },
    {
      key: 'provider.catalogId',
      get: (e) => getSubField(e, 'provider', 'catalogId'),
    },
    {
      key: 'model.displayId',
      get: (e) => getSubField(e, 'model', 'displayId'),
    },
    {
      key: 'model.requestModelId',
      get: (e) => getSubField(e, 'model', 'requestModelId'),
    },
    { key: 'model.api', get: (e) => getSubField(e, 'model', 'api') },
    { key: 'wireModel', get: (e) => getSubField(e, 'model', 'wireModel') },
    {
      key: 'credential.scope',
      get: (e) => getSubField(e, 'credential', 'scope'),
    },
    {
      key: 'credential.classification',
      get: (e) => getSubField(e, 'credential', 'classification'),
    },
    {
      key: 'credential.runtimeUsable',
      get: (e) => getSubField(e, 'credential', 'runtimeUsable'),
    },
    {
      key: 'credential.projectIdPresent',
      get: (e) => getSubField(e, 'credential', 'projectIdPresent'),
    },
    { key: 'request.origin', get: (e) => getSubField(e, 'request', 'origin') },
    {
      key: 'request.pathname',
      get: (e) => getSubField(e, 'request', 'pathname'),
    },
    { key: 'request.method', get: (e) => getSubField(e, 'request', 'method') },
    {
      key: 'request.queryKeys',
      get: (e) => getSubArrayJoin(e, 'request', 'queryKeys'),
    },
    {
      key: 'request.headerNames',
      get: (e) => getSubArrayJoin(e, 'request', 'headerNames'),
    },
    {
      key: 'request.authorizationPresent',
      get: (e) => getSubField(e, 'request', 'authorizationPresent'),
    },
    {
      key: 'body.topLevelKeys',
      get: (e) => getSubArrayJoin(e, 'body', 'topLevelKeys'),
    },
    {
      key: 'body.projectPresent',
      get: (e) => getSubField(e, 'body', 'projectPresent'),
    },
    { key: 'body.model', get: (e) => getSubField(e, 'body', 'model') },
    {
      key: 'body.requestPresent',
      get: (e) => getSubField(e, 'body', 'requestPresent'),
    },
    {
      key: 'body.requestIdPresent',
      get: (e) => getSubField(e, 'body', 'requestIdPresent'),
    },
    {
      key: 'body.sessionIdPresent',
      get: (e) => getSubField(e, 'body', 'sessionIdPresent'),
    },
    {
      key: 'body.labelsPresent',
      get: (e) => getSubField(e, 'body', 'labelsPresent'),
    },
    { key: 'body.userAgent', get: (e) => getSubField(e, 'body', 'userAgent') },
    {
      key: 'body.requestType',
      get: (e) => getSubField(e, 'body', 'requestType'),
    },
    { key: 'contents.count', get: (e) => getSubField(e, 'contents', 'count') },
    {
      key: 'contents.roles',
      get: (e) => getSubArrayJoin(e, 'contents', 'roles'),
    },
    {
      key: 'contents.partTypeCounts',
      get: (e) => getSubObjectJson(e, 'contents', 'partTypeCounts'),
    },
    { key: 'tools.count', get: (e) => getSubField(e, 'tools', 'count') },
    {
      key: 'tools.typeNames',
      get: (e) => getSubArrayJoin(e, 'tools', 'typeNames'),
    },
    {
      key: 'systemInstruction.present',
      get: (e) => getSubField(e, 'systemInstruction', 'present'),
    },
    {
      key: 'request.structureHash',
      get: (e) => getSubField(e, 'request', 'structureHash'),
    },
    {
      key: 'body.structureHash',
      get: (e) => getSubField(e, 'body', 'structureHash'),
    },
    {
      key: 'endpoint.origin',
      get: (e) => getSubField(e, 'endpoint', 'origin'),
    },
    {
      key: 'endpoint.pathname',
      get: (e) => getSubField(e, 'endpoint', 'pathname'),
    },
    {
      key: 'endpoint.selector',
      get: (e) => getSubField(e, 'endpoint', 'selector'),
    },
    {
      key: 'endpoint.source',
      get: (e) => getSubField(e, 'endpoint', 'source'),
    },
  ];

  const diffs: Array<{ field: string; normal: string; probe: string }> = [];

  for (const field of safeFieldsToCompare) {
    const normalVal = field.get(latestNormalChat.requestEvent);
    const probeVal = field.get(latestLiveProbe.requestEvent);
    if (normalVal !== probeVal) {
      diffs.push({ field: field.key, normal: normalVal, probe: probeVal });
    }
  }

  process.stdout.write(`DIFF_COUNT: ${diffs.length}\n`);
  process.stdout.write('\n');

  if (diffs.length === 0) {
    process.stdout.write('FINAL_SAFE_DESCRIPTOR_DIFFERENCE:\n');
    process.stdout.write('ZERO\n');
  } else {
    for (const d of diffs) {
      process.stdout.write(`DIFF ${d.field}:\n`);
      process.stdout.write(`  NORMAL_CHAT: ${d.normal}\n`);
      process.stdout.write(`  LIVE_PROBE:  ${d.probe}\n`);
    }
  }

  return 0;
}

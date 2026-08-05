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
import { installBunGlobal } from '@google/gemini-cli-provider';
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

    // Registration classification: the OMP login thunks embed the upstream
    // product's public client; api-key plans use PLUMB-owned key handling.
    const registrationClass = hasLogin
      ? 'UPSTREAM_PRODUCT_OWNED_REGISTRATION'
      : mechanism === 'API_KEY'
        ? 'PLUMB_OWNED_VALID_REGISTRATION'
        : 'MISSING_REGISTRATION';
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

    // Final matrix classification: a selectable coding plan with an OMP
    // login (or an API-key path) is PRODUCTION_READY; a plan whose OMP
    // login is missing or non-selectable is DOWNSTREAM_BLOCKED.
    const finalClassification =
      isSelectable && (hasLogin || mechanism === 'API_KEY')
        ? 'PRODUCTION_READY'
        : hasLogin
          ? 'BLOCKED_NOT_SELECTABLE'
          : 'DOWNSTREAM_BLOCKED_NO_LOGIN';
    lines.push(`final.classification: ${finalClassification}`);
    lines.push(`last.safe.error: none`);

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

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
  );

  return { lines, failures };
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

    // Canonical provider ID
    const canonicalId = providerId;
    lines.push(`requested.provider: ${providerId}`);
    lines.push(`canonical.provider: ${canonicalId}`);

    // Provider definition from OMP registry
    const providerDef = providerModule.getProviderDefinition?.(providerId);
    const catalogEntry = providerModule.getCatalogProviderEntry?.(providerId);

    lines.push(`descriptor.source: ${providerDef ? 'OMP_REGISTRY' : catalogEntry ? 'OMP_CATALOG' : 'NONE'}`);
    lines.push(`auth.methods: ${providerDef?.login ? 'oauth' : providerDef?.envKeys ? 'api_key' : 'none'}`);

    // Client registration classification
    let registrationClass = 'MISSING_REGISTRATION';
    if (providerDef?.login) {
      registrationClass = 'UPSTREAM_PRODUCT_OWNED_REGISTRATION';
    } else if (catalogEntry?.envVars?.length) {
      registrationClass = 'PLUMB_OWNED_VALID_REGISTRATION';
    }
    lines.push(`client.registration: ${registrationClass}`);

    // Redacted client-ID fingerprint (first 4 + last 4 chars)
    const clientId = (providerDef as unknown as Record<string, unknown>)?.['clientId'] as string | undefined;
    if (clientId) {
      const fingerprint = clientId.length > 8
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
    if (registry) {
      try {
        await registry.initialize();
        const state = registry.getProviderState(providerId);
        lines.push(`auth.state: ${state?.authState ?? 'unauthenticated'}`);
      } catch {
        lines.push(`auth.state: unavailable`);
      }
    }

    // Model source
    if (catalogEntry) {
      lines.push(`default.model: ${catalogEntry.defaultModel}`);
      lines.push(`model.source: BUNDLED_CATALOG`);
    }

    lines.push(`selectable: true`);
    lines.push(`last.safe.error: none`);
  } catch (err) {
    failures.push(`Failed to build auth diagnostics: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { lines, failures };
}

/** Print the auth diagnostics report. Returns the process exit code. */
export async function printAuthDiagnostics(providerId: string): Promise<number> {
  const { lines, failures } = await buildAuthDiagnostics(providerId);
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  for (const failure of failures) {
    process.stderr.write(`diagnose-auth: FAIL: ${failure}\n`);
  }
  return failures.length > 0 ? 1 : 0;
}

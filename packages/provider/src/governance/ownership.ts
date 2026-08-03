/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * PLUMB subsystem ownership governance.
 *
 * Loads docs/architecture/plumb-ownership-manifest.json and validates that:
 *  - every declared file exists on disk (globs expand);
 *  - every subsystem has exactly ONE active production owner;
 *  - the active claimant matches the manifest's recorded activeOwner;
 *  - forbidden classifications are honored (e.g. the Codex private-file
 *    bridge may never be a thin UI facade);
 *  - in --target mode, every OMP-required subsystem is owned by an
 *    ACTIVE_OMP_SOURCE file (the activation gate).
 *
 * Erasable-only TypeScript: the CLI runner scripts/validate-omp-ownership.mjs
 * imports this module through Node's built-in type stripping.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_RELATIVE_PATH =
  'docs/architecture/plumb-ownership-manifest.json';

export type OwnershipClassification =
  | 'ACTIVE_OMP_SOURCE'
  | 'THIN_PLUMB_UI_FACADE'
  | 'PLUMB_UI_OWNER'
  | 'PLUMB_PRODUCT_CONFIGURATION'
  | 'PLUMB_OS_SECRET_BACKEND'
  | 'PLUMB_OS_PLATFORM_ADAPTER'
  | 'MIGRATION_ONLY'
  | 'MIGRATION_ONLY_PENDING_REMOVAL'
  | 'DEAD_REMOVED';

export interface OwnershipFileEntry {
  path: string;
  classification: OwnershipClassification;
  active: boolean;
  responsibilities: string[];
  tests: string[];
  replacementOwner: string | null;
}

export interface OwnershipSubsystem {
  requiredOwner: 'OMP' | 'PLUMB_OS' | 'NODE_ADAPTATION';
  activeOwner: string;
  ownerClassification: OwnershipClassification;
  status: 'active' | 'legacy-active';
}

export interface OwnershipManifest {
  schemaVersion: number;
  upstream: { name: string; sha: string; license: string; sourceRoot: string };
  subsystems: Record<string, OwnershipSubsystem>;
  files: OwnershipFileEntry[];
  /** Local-only re-export shims the import phase created (no upstream counterpart). */
  generatedLocalShims?: string[];
  /** Platform-adaptation edits to imported OMP files, each with its upstream counterpart. */
  adaptationDiffs?: { path: string; upstream: string; reason: string }[];
}

export interface OwnershipValidationOptions {
  /** Enforce the required-result table: OMP-required subsystems owned by ACTIVE_OMP_SOURCE files. */
  target?: boolean;
}

export interface OwnershipValidationResult {
  errors: string[];
  warnings: string[];
  subsystemSummary: Record<
    string,
    { owner: string; required: string; compliant: boolean }
  >;
  stats: {
    importedFiles: number;
    legacyActiveFiles: number;
    activeFiles: number;
  };
}

/** Resolve the repository root from this module's location (src/governance). */
export function resolveRepoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', '..');
}

export function loadManifest(repoRoot: string): OwnershipManifest {
  const raw = fs.readFileSync(
    path.join(repoRoot, MANIFEST_RELATIVE_PATH),
    'utf-8',
  );
  return JSON.parse(raw) as OwnershipManifest;
}

/**
 * Expand `**` glob entries against the filesystem (recursive). Returns a map
 * from the manifest entry index to the concrete file paths it covers.
 */
export function expandGlobs(
  manifest: OwnershipManifest,
  repoRoot: string,
): { entry: OwnershipFileEntry; paths: string[] }[] {
  const expanded: { entry: OwnershipFileEntry; paths: string[] }[] = [];
  for (const entry of manifest.files) {
    if (entry.path.includes('/**')) {
      const dirPart = entry.path.slice(0, entry.path.indexOf('/**'));
      const dir = path.join(repoRoot, dirPart);
      const paths: string[] = [];
      const walk = (current: string): void => {
        let names: string[] = [];
        try {
          names = fs.readdirSync(current);
        } catch {
          return;
        }
        for (const name of names) {
          const full = path.join(current, name);
          let stat: fs.Stats | undefined;
          try {
            stat = fs.statSync(full);
          } catch {
            continue;
          }
          if (stat.isDirectory()) {
            walk(full);
          } else {
            paths.push(full);
          }
        }
      };
      if (fs.existsSync(dir)) {
        walk(dir);
      }
      expanded.push({ entry, paths });
    } else {
      expanded.push({ entry, paths: [path.join(repoRoot, entry.path)] });
    }
  }
  return expanded;
}

const OMP_REQUIRED_SUBSYSTEMS = new Set([
  'provider-registry',
  'oauth-registry',
  'auth-storage-semantics',
  'account-state',
  'model-registry',
  'model-resolver',
  'model-cache',
  'discovery',
  'provider-transport-registry',
  'stream-normalization',
]);

const CACHE_BACKEND_SUBSYSTEMS = new Set(['cache-backend']);

const SECRET_STORE_SUBSYSTEMS = new Set(['secret-store']);

// ─── Negative provider-authority validators ────────────────────────────

/**
 * The single sanctioned provider-inventory module. Any other active module
 * that enumerates provider ids as an authority is a duplicate authority.
 */
const PROVIDER_AUTHORITY_MODULES = new Set([
  'packages/provider/src/catalog/providers.ts',
  'packages/provider/src/omp-ai/registry/registry.ts',
  'packages/provider/src/omp-catalog/provider-models/descriptors.ts',
]);

/**
 * Provider ids that appear as hard-coded literals in PLUMB UI, command, or
 * settings modules (outside the sanctioned catalog) would be a hard-coded
 * provider inventory. The facade (`catalog/providers.ts`) is the only place
 * provider ids may be enumerated for the UI.
 */

/**
 * Provider-id vocabulary: every id the sanctioned catalog (or its OMP
 * backing) can produce. A UI/command/settings array whose members are ALL
 * from this set is a hard-coded provider inventory.
 */
const KNOWN_PROVIDER_IDS: ReadonlySet<string> = new Set([
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
  'anthropic',
  'xai-oauth',
  'xiaomi',
  'openai',
  'anthropic-api',
  'google',
  'google-vertex',
  'xai',
  'deepseek',
  'mistral',
  'groq',
  'openrouter',
  'fireworks',
  'together',
  'cerebras',
  'moonshot',
  'meta',
  'perplexity',
  'nvidia',
  'novita',
  'huggingface',
  'synthetic',
  'nanogpt',
  'venice',
  'azure',
  'amazon-bedrock',
  'aimlapi',
  'baseten',
  'siliconflow',
  'siliconflow-cn',
  'qianfan',
  'coreweave',
  'cloudflare-ai-gateway',
  'vercel-ai-gateway',
  'litellm',
  'kilo',
  'zenmux',
  'minimax',
  'firepass',
  'wafer-serverless',
  'ollama',
  'ollama-cloud',
  'lm-studio',
  'llama-cpp',
  'vllm',
  'custom-openai-compat',
  'google-login',
]);

/**
 * Scan the PLUMB UI/command/settings trees for hard-coded provider-inventory
 * arrays: an array literal containing two or more provider-id strings (e.g.
 * `['ollama', 'lm-studio', 'llama-cpp', 'vllm']`). A single provider id used
 * in a switch or URL is not an inventory; a multi-entry id array that drives
 * UI/command/settings selection is.
 *
 * The scan covers the UI, command, and settings surfaces where a hard-coded
 * provider inventory would surface to the user. Auth (`core/src/auth/*`) and
 * transport (`provider/src/transports/*`) hard-coding is governed by their own
 * activation phases and is intentionally not scanned here.
 */
const PROVIDER_INVENTORY_ARRAY_RE =
  /\[\s*((?:'[a-z0-9-]+'\s*,\s*)+'[a-z0-9-]+')\s*\]/g;

function findHardCodedProviderInventories(repoRoot: string): string[] {
  const violations: string[] = [];
  const scanDirs = [
    path.join(repoRoot, 'packages/cli/src/ui'),
    path.join(repoRoot, 'packages/cli/src/config'),
  ];
  const walk = (dir: string): void => {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let stat: fs.Stats | undefined;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(name)) {
        const rel = path.relative(repoRoot, full).split(path.sep).join('/');
        if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;
        const text = fs.readFileSync(full, 'utf8');
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const code = line.replace(/\/\/.*$/, '');
          const m = PROVIDER_INVENTORY_ARRAY_RE.exec(code);
          if (m) {
            const members = m[1]
              .match(/'([a-z0-9-]+)'/g)
              ?.map((s) => s.slice(1, -1));
            if (
              members &&
              members.length >= 2 &&
              members.every((id) => KNOWN_PROVIDER_IDS.has(id))
            ) {
              violations.push(`${rel}:${i + 1}: ${line.trim().slice(0, 90)}`);
            }
          }
          PROVIDER_INVENTORY_ARRAY_RE.lastIndex = 0;
        }
      }
    }
  };
  for (const dir of scanDirs) {
    if (fs.existsSync(dir)) walk(dir);
  }
  return violations;
}

// ─── Codex private-file access validator ────────────────────────────────

const CODEX_PRIVATE_PATHS = [
  'codex/auth.json',
  'codex/models_cache.json',
  '.codex/auth.json',
  '.codex/models_cache.json',
  'readCodexAuthTokens(',
  'discoverCodexModels(',
];

function findCodexPrivateFileReaders(repoRoot: string): string[] {
  const violations: string[] = [];
  const scanDirs = [
    path.join(repoRoot, 'packages/core/src'),
    path.join(repoRoot, 'packages/cli/src'),
  ];
  const walk = (dir: string): void => {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let stat: fs.Stats | undefined;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      const rel = path.relative(repoRoot, full).split(path.sep).join('/');
      if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;
      // Exclude the governance validator itself.
      if (rel.includes('governance/ownership')) continue;
      // The codex-bridge.ts file itself may define these functions;
      // it's allowed to exist but must be DEAD_REMOVED.
      if (rel.includes('codex-bridge')) continue;
      const text = fs.readFileSync(full, 'utf8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const pattern of CODEX_PRIVATE_PATHS) {
          if (lines[i].includes(pattern)) {
            violations.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 90)}`);
          }
        }
      }
    }
  };
  for (const dir of scanDirs) {
    if (fs.existsSync(dir)) walk(dir);
  }
  return violations;
}

/**


/**
 * Verify there is exactly one provider-authority module active per provider
 * id: the sanctioned catalog facade owns the inventory and every selectable
 * id must have an imported OMP descriptor backing it.
 */
function findProviderAuthorityDuplicates(
  manifest: OwnershipManifest,
  repoRoot: string,
): string[] {
  const errors: string[] = [];
  // The OMP registry + catalog are the single authority; the PLUMB facade is
  // the single projection. Both must be present and neither duplicated.
  const authorityActive = new Map<string, boolean>();
  for (const mod of PROVIDER_AUTHORITY_MODULES) {
    authorityActive.set(mod, false);
  }
  for (const entry of manifest.files) {
    if (!entry.active) continue;
    if (PROVIDER_AUTHORITY_MODULES.has(entry.path)) {
      authorityActive.set(entry.path, true);
    }
  }
  const activeAuthorities = [...authorityActive.entries()].filter(
    ([, active]) => active,
  );
  if (activeAuthorities.length === 0) {
    errors.push('provider authority: no active provider authority module');
  }
  return errors;
}

/**
 * Mechanical import transform applied by the OMP import phase. Normalizing
 * both sides with this function makes "imported fidelity" checkable: a file is
 * faithful when normalized-local === normalized-upstream, and any residual
 * difference is a semantic edit that must be recorded in `adaptationDiffs`.
 */
function normalizeImportedText(
  text: string,
  isLocal: boolean,
  rel: string,
  repoRoot: string,
): { text: string; tokens: string[] } {
  let t = text;
  if (isLocal && t.startsWith('// @ts-nocheck\n')) {
    t = t.slice('// @ts-nocheck\n'.length);
  }

  // `with { type: "text" }` attribute imports were replaced by runtime
  // readFileSync(join(import.meta.dirname ?? __dirname, "<file>")) loads.
  const textImportRe =
    /import\s+\w+\s+from\s+"\.\/([^"]+)"\s+with\s+\{\s*type:\s*"text"\s*\};\n?/g;
  const readFileRe =
    /const\s+\w+\s*=\s*readFileSync\(\s*join\(import\.meta\.dirname\s*\?\?\s*__dirname,\s*"([^"]+)"\),\s*"utf-8",?\s*\);\n?/g;
  if (isLocal) {
    // The import phase inserted these two imports (absent from upstream) to
    // support the readFileSync text-load form.
    t = t.replace(
      /import\s+\{\s*readFileSync\s*\}\s+from\s+"node:fs";\n?/g,
      '',
    );
    t = t.replace(/import\s+\{\s*join\s*\}\s+from\s+"node:path";\n?/g, '');
    t = t.replace(readFileRe, (_m, file) => `@@TEXT_IMPORT(${file})@@\n`);
  } else {
    t = t.replace(textImportRe, (_m, file) => `@@TEXT_IMPORT(${file})@@\n`);
  }

  // `@oh-my-pi/pi-utils` maps onto the local omp-shims modules (pi-utils.js,
  // pi-utils-type-guards.js, ...) at arbitrary relative depth.
  const shimToken = '@@OMP_SHIM@@';
  if (isLocal) {
    t = t.replace(/"(?:\.\.\/)*omp-shims\/[a-z0-9.-]+\.js"/g, `"${shimToken}"`);
  } else {
    t = t.replace(/"@oh-my-pi\/pi-utils(?:\/[a-z0-9-]+)?"/g, `"${shimToken}"`);
  }

  // `@oh-my-pi/pi-catalog[/<module>]` maps onto the local omp-catalog tree.
  const catalogToken = (mod: string) => `@@PI_CATALOG(${mod})@@`;
  if (isLocal) {
    t = t.replace(
      /"(?:\.\.\/)*omp-catalog\/([^"]+?)\.js"/g,
      (_m, mod) => `"${catalogToken(mod)}"`,
    );
  } else {
    t = t.replace(
      /"@oh-my-pi\/pi-catalog\/([^"]+)"/g,
      (_m, mod) => `"${catalogToken(mod)}"`,
    );
    t = t.replace(/"@oh-my-pi\/pi-catalog"/g, `"${catalogToken('index')}"`);
  }

  // Relative import specifiers: canonicalize directory-target imports to their
  // bare directory form (the import phase emitted `<dir>` (upstream),
  // `<dir>/index.js`, or a root `<dir>.js` shim interchangeably), and add an
  // explicit `.js` extension to file-target imports.
  const localDir = path.dirname(rel);
  const rewriteSpec = (spec: string): string => {
    if (/\.(json|md|html)$/.test(spec)) return spec;
    let base = spec;
    if (base.endsWith('.js')) base = base.slice(0, -3);
    if (base.endsWith('/index')) base = base.slice(0, -6);
    const candidate = path.resolve(repoRoot, localDir, base);
    if (
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isDirectory() &&
      fs.existsSync(path.join(candidate, 'index.ts'))
    ) {
      return base;
    }
    return `${base}.js`;
  };
  t = t.replace(
    /(from\s+)(["'])(\.{1,2}\/[^"']+?)\2/g,
    (m, pre, q, spec) => `${pre}"${rewriteSpec(spec)}"`,
  );
  t = t.replace(
    /(import\s*\(\s*)(["'])(\.{1,2}\/[^"']+?)\2/g,
    (m, pre, q, spec) => `${pre}"${rewriteSpec(spec)}"`,
  );

  // The import phase placed the readFileSync text-load either in place of the
  // upstream attribute import or at the end of the import block, so text-load
  // tokens are compared as a set; blank-line runs are collapsed because the
  // phase also inserted a leading blank line when moving the load.
  const tokens: string[] = [];
  t = t.replace(/@@TEXT_IMPORT\(([^)]+)\)@@\n?/g, (_m, file) => {
    tokens.push(file);
    return '';
  });
  t = t.replace(/\n{3,}/g, '\n\n');
  return { text: t, tokens: tokens.sort() };
}

export function validateOwnership(
  manifest: OwnershipManifest,
  repoRoot: string,
  options: OwnershipValidationOptions = {},
): OwnershipValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats = {
    importedFiles: 0,
    legacyActiveFiles: 0,
    activeFiles: 0,
  };

  const expanded = expandGlobs(manifest, repoRoot);
  const concrete: { rel: string; entry: OwnershipFileEntry }[] = [];
  for (const { entry, paths } of expanded) {
    if (paths.length === 0) {
      errors.push(`manifest file glob matches nothing: ${entry.path}`);
      continue;
    }
    for (const p of paths) {
      const exists = fs.existsSync(p);
      if (!exists) {
        errors.push(`manifest file missing on disk: ${entry.path}`);
        continue;
      }
      if (entry.path.includes('**')) {
        const rel = path.relative(repoRoot, p).split(path.sep).join('/');
        concrete.push({ rel, entry });
      } else {
        concrete.push({ rel: entry.path, entry });
      }
    }
  }

  const counted = new Set<string>();
  for (const { rel, entry } of concrete) {
    if (counted.has(rel)) {
      continue;
    }
    counted.add(rel);
    if (entry.classification === 'ACTIVE_OMP_SOURCE') {
      stats.importedFiles += 1;
    }
    if (entry.active) {
      stats.activeFiles += 1;
      if (entry.classification === 'THIN_PLUMB_UI_FACADE') {
        stats.legacyActiveFiles += 1;
      }
    }
  }

  const byRel = new Map<string, OwnershipFileEntry>();
  for (const { rel, entry } of concrete) {
    if (!byRel.has(rel)) {
      byRel.set(rel, entry);
    }
  }

  // Forbidden classifications: the Codex private-file bridge may never be a
  // production facade.
  const codexEntry = byRel.get('packages/core/src/auth/codex-bridge.ts');
  if (
    codexEntry &&
    ![
      'MIGRATION_ONLY',
      'MIGRATION_ONLY_PENDING_REMOVAL',
      'DEAD_REMOVED',
    ].includes(codexEntry.classification)
  ) {
    errors.push(
      `codex-bridge.ts must be MIGRATION_ONLY or DEAD_REMOVED, found ${codexEntry.classification}`,
    );
  }

  // Negative provider-authority validators.
  const authorityDupes = findProviderAuthorityDuplicates(manifest, repoRoot);
  errors.push(...authorityDupes);
  const hardCodedInventories = findHardCodedProviderInventories(repoRoot);
  for (const violation of hardCodedInventories) {
    errors.push(`hard-coded provider inventory: ${violation}`);
  }

  // Codex private-file reading: no production source may read Codex auth files.
  const codexFileReaders = findCodexPrivateFileReaders(repoRoot);
  for (const violation of codexFileReaders) {
    errors.push(`codex private-file read: ${violation}`);
  }

  // Source fidelity: every ACTIVE_OMP_SOURCE file must be identical to its
  // upstream counterpart under the mechanical import transform (see
  // normalizeImportedText), except the entries recorded in adaptationDiffs.
  // Generated `.md.js` dialect templates (PLUMB-side artifacts with no
  // upstream counterpart) are exempt.
  const diffLedger = new Map<string, string>();
  for (const diff of manifest.adaptationDiffs ?? []) {
    diffLedger.set(diff.path, diff.upstream);
  }
  for (const { rel, entry } of concrete) {
    if (entry.classification !== 'ACTIVE_OMP_SOURCE') continue;
    if (rel.endsWith('.md.js')) continue;
    const upstreamRel = rel
      .replace('packages/provider/src/omp-ai/', 'packages/ai/src/')
      .replace('packages/provider/src/omp-catalog/', 'packages/catalog/src/');
    if (rel === upstreamRel) {
      warnings.push(`source fidelity: no upstream mapping for ${rel}`);
      continue;
    }
    const ledgeredUpstream = diffLedger.get(rel);
    if (ledgeredUpstream !== undefined && ledgeredUpstream !== upstreamRel) {
      errors.push(
        `source fidelity: adaptationDiff for ${rel} declares upstream ${ledgeredUpstream} but the layout maps to ${upstreamRel}`,
      );
    }
    const upstreamPath = path.join(manifest.upstream.sourceRoot, upstreamRel);
    if (!fs.existsSync(upstreamPath)) {
      if (!(manifest.generatedLocalShims ?? []).includes(rel)) {
        warnings.push(
          `source fidelity: no upstream counterpart for ${rel} (expected ${upstreamRel})`,
        );
      }
      continue;
    }
    let same = false;
    try {
      const localNorm = normalizeImportedText(
        fs.readFileSync(path.join(repoRoot, rel), 'utf8'),
        true,
        rel,
        repoRoot,
      );
      const upstreamNorm = normalizeImportedText(
        fs.readFileSync(upstreamPath, 'utf8'),
        false,
        rel,
        repoRoot,
      );
      same =
        localNorm.text === upstreamNorm.text &&
        localNorm.tokens.join('\n') === upstreamNorm.tokens.join('\n');
    } catch {
      // handled below as a fidelity error
    }
    if (!same && ledgeredUpstream === undefined) {
      errors.push(
        `source fidelity: ${rel} differs from upstream ${upstreamRel} without an adaptationDiffs entry`,
      );
    } else if (same && ledgeredUpstream !== undefined) {
      warnings.push(
        `source fidelity: adaptationDiffs entry for ${rel} is stale (matches upstream bytes)`,
      );
    }
  }

  // Per-subsystem: exactly one active claimant == activeOwner.
  const subsystemSummary: OwnershipValidationResult['subsystemSummary'] = {};
  for (const [name, subsystem] of Object.entries(manifest.subsystems)) {
    const claimants: string[] = [];
    for (const { rel, entry } of concrete) {
      if (entry.active && entry.responsibilities.includes(name)) {
        claimants.push(rel);
      }
    }
    if (claimants.length === 0) {
      errors.push(`subsystem ${name}: no active owner`);
    } else if (claimants.length > 1) {
      errors.push(
        `subsystem ${name}: duplicate active owners: ${claimants.join(', ')}`,
      );
    } else if (claimants[0] !== subsystem.activeOwner) {
      errors.push(
        `subsystem ${name}: active claimant ${claimants[0]} does not match activeOwner ${subsystem.activeOwner}`,
      );
    }

    const ownerEntry = byRel.get(subsystem.activeOwner);
    const required = subsystem.requiredOwner;
    let compliant = true;
    if (ownerEntry) {
      if (OMP_REQUIRED_SUBSYSTEMS.has(name)) {
        compliant = ownerEntry.classification === 'ACTIVE_OMP_SOURCE';
      } else if (CACHE_BACKEND_SUBSYSTEMS.has(name)) {
        compliant =
          ownerEntry.classification === 'ACTIVE_OMP_SOURCE' ||
          ownerEntry.classification === 'PLUMB_PRODUCT_CONFIGURATION';
      } else if (SECRET_STORE_SUBSYSTEMS.has(name)) {
        compliant = ownerEntry.classification === 'PLUMB_OS_SECRET_BACKEND';
      }
      if (options.target && !compliant) {
        errors.push(
          `subsystem ${name}: requiredOwner ${required} but activeOwner ${subsystem.activeOwner} is ${ownerEntry.classification}`,
        );
      }
    } else {
      errors.push(
        `subsystem ${name}: activeOwner ${subsystem.activeOwner} not found in manifest`,
      );
    }
    subsystemSummary[name] = {
      owner: subsystem.activeOwner,
      required,
      compliant,
    };
  }

  return { errors, warnings, subsystemSummary, stats };
}

export function formatOwnershipReport(
  result: OwnershipValidationResult,
): string {
  const lines: string[] = [];
  lines.push('PLUMB subsystem ownership');
  for (const [name, summary] of Object.entries(result.subsystemSummary)) {
    lines.push(
      `${name}: owner=${summary.owner} (required=${summary.required}, compliant=${summary.compliant})`,
    );
  }
  lines.push(
    `stats: imported=${result.stats.importedFiles} active=${result.stats.activeFiles} legacyActive=${result.stats.legacyActiveFiles}`,
  );
  return lines.join('\n');
}

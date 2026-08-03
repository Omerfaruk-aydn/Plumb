/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Governance contract: exactly one active production owner per subsystem.
 *
 * The ownership manifest (docs/architecture/plumb-ownership-manifest.json)
 * records, per subsystem, the single active owner file. These tests enforce
 * the manifest invariants that must hold both before and after OMP runtime
 * activation:
 *  - the manifest is well-formed and every declared file exists on disk;
 *  - current-mode validation reports zero errors (no duplicate active owner,
 *    no missing owner, no owner mismatch);
 *  - the required-result table is encoded: OMP-required subsystems declare
 *    requiredOwner "OMP", the secret store declares "PLUMB_OS";
 *  - target-mode validation never flags the storage layers (secret-store,
 *    cache-backend), which are owned by non-OMP adapters by design.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  loadManifest,
  resolveRepoRoot,
  validateOwnership,
  expandGlobs,
} from './ownership.js';

const PINNED_OMP_SHA = '4df68d60438423b384b2b47fb3d6835641624757';

const OMP_REQUIRED = [
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
];

describe('ownership manifest', () => {
  it('is well-formed and pinned to the accepted upstream SHA', () => {
    const repoRoot = resolveRepoRoot();
    const manifest = loadManifest(repoRoot);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.upstream.sha).toBe(PINNED_OMP_SHA);
    expect(Object.keys(manifest.subsystems).length).toBeGreaterThanOrEqual(11);
    expect(manifest.files.length).toBeGreaterThan(10);
  });

  it('declares every file that exists on disk (and no dangling paths)', () => {
    const repoRoot = resolveRepoRoot();
    const manifest = loadManifest(repoRoot);
    const expanded = expandGlobs(manifest, repoRoot);
    expect(expanded.length).toBe(manifest.files.length);
    for (const { entry, paths } of expanded) {
      expect(
        paths.length,
        `glob matches nothing: ${entry.path}`,
      ).toBeGreaterThan(0);
      for (const p of paths) {
        expect(fs.existsSync(p), `missing on disk: ${entry.path}`).toBe(true);
      }
    }
    const importedFiles = manifest.files
      .filter((f) => f.classification === 'ACTIVE_OMP_SOURCE')
      .reduce(
        (sum, f) =>
          sum +
          (f.path.includes('/**')
            ? (expanded.find((e) => e.entry === f)?.paths.length ?? 0)
            : 1),
        0,
      );
    expect(importedFiles).toBeGreaterThan(400);
  });

  it('reports zero current-mode errors: exactly one active owner per subsystem', () => {
    const repoRoot = resolveRepoRoot();
    const manifest = loadManifest(repoRoot);
    const result = validateOwnership(manifest, repoRoot);
    expect(result.errors).toEqual([]);
    for (const [name, summary] of Object.entries(result.subsystemSummary)) {
      expect(summary.owner.length).toBeGreaterThan(0);
      expect(
        result.errors.some((e) => e.includes(`duplicate active owners`)),
      ).toBe(false);
      expect(name).toMatch(/^[a-z-]+$/);
    }
  });

  it('encodes the required-result table in the manifest', () => {
    const repoRoot = resolveRepoRoot();
    const manifest = loadManifest(repoRoot);
    for (const subsystem of OMP_REQUIRED) {
      expect(
        manifest.subsystems[subsystem]?.requiredOwner,
        `${subsystem} must declare requiredOwner OMP`,
      ).toBe('OMP');
    }
    expect(manifest.subsystems['secret-store']?.requiredOwner).toBe('PLUMB_OS');
    expect(manifest.subsystems['cache-backend']?.requiredOwner).toBe(
      'NODE_ADAPTATION',
    );
  });

  it('keeps the OS secret store target-compliant (PLUMB-owned adapter by design)', () => {
    const repoRoot = resolveRepoRoot();
    const manifest = loadManifest(repoRoot);
    const result = validateOwnership(manifest, repoRoot, { target: true });
    const secretStoreErrors = result.errors.filter((e) =>
      e.includes('secret-store'),
    );
    expect(secretStoreErrors).toEqual([]);
    expect(manifest.subsystems['secret-store'].ownerClassification).toBe(
      'PLUMB_OS_SECRET_BACKEND',
    );
    expect(manifest.subsystems['cache-backend'].requiredOwner).toBe(
      'NODE_ADAPTATION',
    );
  });

  it('records every post-import semantic edit in adaptationDiffs (none stale)', () => {
    const repoRoot = resolveRepoRoot();
    const manifest = loadManifest(repoRoot);
    expect(manifest.adaptationDiffs).toBeDefined();
    const diffs = manifest.adaptationDiffs ?? [];
    expect(diffs.length).toBeGreaterThanOrEqual(6);
    const seen = new Set<string>();
    for (const diff of diffs) {
      expect(
        seen.has(diff.path),
        `duplicate adaptationDiff: ${diff.path}`,
      ).toBe(false);
      seen.add(diff.path);
      expect(
        fs.existsSync(path.join(repoRoot, diff.path)),
        `adaptationDiff local file missing: ${diff.path}`,
      ).toBe(true);
      expect(
        fs.existsSync(path.join(manifest.upstream.sourceRoot, diff.upstream)),
        `adaptationDiff upstream file missing: ${diff.upstream}`,
      ).toBe(true);
    }
    const result = validateOwnership(manifest, repoRoot);
    const stale = result.warnings.filter((w) => w.includes('is stale'));
    expect(stale).toEqual([]);
    const unexplained = result.warnings.filter((w) =>
      w.includes('source fidelity:'),
    );
    expect(unexplained).toEqual([]);
    for (const shim of manifest.generatedLocalShims ?? []) {
      expect(
        fs.existsSync(path.join(repoRoot, shim)),
        `generatedLocalShim missing: ${shim}`,
      ).toBe(true);
    }
  });

  it('enforces negative provider-authority invariants (no duplicate authority, no hard-coded UI inventory)', () => {
    const repoRoot = resolveRepoRoot();
    const manifest = loadManifest(repoRoot);
    const result = validateOwnership(manifest, repoRoot);

    // The provider-registry authority is the imported OMP registry, not a
    // PLUMB-maintained inventory.
    expect(manifest.subsystems['provider-registry'].activeOwner).toBe(
      'packages/provider/src/omp-ai/registry/registry.ts',
    );
    expect(manifest.subsystems['provider-registry'].ownerClassification).toBe(
      'ACTIVE_OMP_SOURCE',
    );

    // Exactly one provider-authority module is active (no duplicates).
    const authorityErrors = result.errors.filter((e) =>
      e.includes('provider authority'),
    );
    expect(authorityErrors).toEqual([]);

    // No hard-coded provider-id inventory arrays remain in UI/config.
    const inventoryErrors = result.errors.filter((e) =>
      e.includes('hard-coded provider inventory'),
    );
    expect(inventoryErrors).toEqual([]);
  });
});

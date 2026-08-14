/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../');

describe('bundle bootstrap ordering', () => {
  it('builds provider and core, in that order, before esbuild runs', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const bundleScript = pkg.scripts['bundle'];
    expect(bundleScript).toBeTruthy();

    const providerBuildIndex = bundleScript.indexOf('build -w @plumb/provider');
    const coreBuildIndex = bundleScript.indexOf('build -w @plumb/core');
    const esbuildIndex = bundleScript.indexOf('esbuild.config.js');

    expect(
      providerBuildIndex,
      'bundle must build @plumb/provider (esbuild resolves it via dist/index.js)',
    ).toBeGreaterThanOrEqual(0);
    expect(
      coreBuildIndex,
      'bundle must build @plumb/core (esbuild resolves it via dist/index.js)',
    ).toBeGreaterThanOrEqual(0);
    expect(esbuildIndex).toBeGreaterThanOrEqual(0);

    // Provider must build strictly before core -- core's build imports the
    // provider's exports (see packages/core/src/config/plumbInit.ts), so
    // building core first against a missing provider dist would itself fail
    // or, worse, silently build against stale types.
    expect(
      providerBuildIndex,
      'provider must be built before core (core depends on provider)',
    ).toBeLessThan(coreBuildIndex);
    expect(
      coreBuildIndex,
      'both provider and core must build before esbuild.config.js runs',
    ).toBeLessThan(esbuildIndex);
  });

  it('the prepare lifecycle script (what `npm ci` runs) reaches bundle', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts['prepare']).toMatch(/npm run bundle\b/);
  });

  it('esbuild.config.js does not externalize the provider/core workspaces (so this ordering is actually load-bearing)', () => {
    const esbuildConfigSource = fs.readFileSync(
      path.join(projectRoot, 'esbuild.config.js'),
      'utf8',
    );
    // If the provider package ever becomes externalized instead of
    // resolved-and-bundled, this ordering fix (and this guard) should be
    // revisited together -- externalizing removes the load-bearing need for
    // dist/index.js to exist before esbuild runs.
    expect(esbuildConfigSource).not.toContain('@plumb/provider');
  });
});

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// npm install if node_modules was removed (e.g. via npm run clean or scripts/clean.js)
if (!existsSync(join(root, 'node_modules'))) {
  execSync('npm install', { stdio: 'inherit', cwd: root });
}

// build all workspaces/packages
execSync('npm run generate', { stdio: 'inherit', cwd: root });

if (process.env.CI) {
  console.log('CI environment detected. Building workspaces sequentially...');
  execSync('npm run build --workspaces', { stdio: 'inherit', cwd: root });
} else {
  // Build provider and core first (provider is a dependency of core)
  console.log('Building @plumb/provider...');
  execSync('npm run build -w @plumb/provider', {
    stdio: 'inherit',
    cwd: root,
  });

  console.log('Building @plumb/core...');
  execSync('npm run build -w @plumb/core', {
    stdio: 'inherit',
    cwd: root,
  });

  // Build the rest in parallel
  console.log('Building other workspaces in parallel...');
  const workspaceInfo = JSON.parse(
    execSync('npm query .workspace --json', { cwd: root, encoding: 'utf-8' }),
  );
  const parallelWorkspaces = workspaceInfo
    .map((w) => w.name)
    .filter((name) => name !== '@plumb/core' && name !== '@plumb/provider');

  execSync(
    `npx --no-install npm-run-all --parallel ${parallelWorkspaces.map((w) => `"build -w ${w}"`).join(' ')}`,
    { stdio: 'inherit', cwd: root },
  );
}

// also build container image if sandboxing is enabled
// skip (-s) npm install + build since we did that above
try {
  execSync('node scripts/sandbox_command.js -q', {
    stdio: 'inherit',
    cwd: root,
  });
  if (
    process.env.BUILD_SANDBOX === '1' ||
    process.env.BUILD_SANDBOX === 'true'
  ) {
    execSync('node scripts/build_sandbox.js -s', {
      stdio: 'inherit',
      cwd: root,
    });
  }
} catch {
  // ignore
}

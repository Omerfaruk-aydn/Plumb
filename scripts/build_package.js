/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';

if (!process.cwd().includes('packages')) {
  console.error('must be invoked from a package directory');
  process.exit(1);
}

const packageName = basename(process.cwd());

// Clean dist for provider package (uses bundler moduleResolution, no --build)
if (packageName === 'provider') {
  const distDir = join(process.cwd(), 'dist');
  if (existsSync(distDir)) {
    rmSync(distDir, { recursive: true, force: true });
  }
}

// build typescript files
// Use tsc without --build for provider package (uses bundler moduleResolution)
if (packageName === 'provider') {
  execSync('tsc', { stdio: 'inherit' });
  // Copy non-TypeScript assets (.md, .md.js, .html, .json, extension-less
  // files) from the whole src/ tree into dist/ with layout preserved.
  // TypeScript emits neither the OMP dialect prompts (.md / .md.js) nor the
  // JSON modules (models.json, package.json) that the compiled JS imports
  // at runtime (`with { type: "json" }` is native on Node 24).
  const srcDir = join(process.cwd(), 'src');
  const distDir = join(process.cwd(), 'dist');
  const isCopyableAsset = (base) =>
    base.endsWith('.md') ||
    base.endsWith('.md.js') ||
    base.endsWith('.html') ||
    base.endsWith('.json') ||
    !base.includes('.');
  if (existsSync(srcDir) && existsSync(distDir)) {
    cpSync(srcDir, distDir, {
      recursive: true,
      filter: (src) => isCopyableAsset(basename(src)),
    });
  }
} else {
  execSync('tsc --build', { stdio: 'inherit' });
}

// Run package-specific bundling if the script exists
const bundleScript = join(process.cwd(), 'scripts', 'bundle-browser-mcp.mjs');
if (packageName === 'core' && existsSync(bundleScript)) {
  console.log('Running chrome devtools MCP bundling...');
  execSync('npm run bundle:browser-mcp', {
    stdio: 'inherit',
  });
}

// copy .{md,json} files
execSync('node ../../scripts/copy_files.js', { stdio: 'inherit' });

// Copy documentation for the core package
if (packageName === 'core') {
  const docsSource = join(process.cwd(), '..', '..', 'docs');
  const docsTarget = join(process.cwd(), 'dist', 'docs');
  if (existsSync(docsSource)) {
    cpSync(docsSource, docsTarget, { recursive: true, dereference: true });
    console.log('Copied documentation to dist/docs');
  }
}

// touch dist/.last_build
writeFileSync(join(process.cwd(), 'dist', '.last_build'), '');
process.exit(0);

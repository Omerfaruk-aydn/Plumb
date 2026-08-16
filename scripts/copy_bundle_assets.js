/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyFileSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'glob';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const bundleDir = join(root, 'bundle');

// Create the bundle directory if it doesn't exist
if (!existsSync(bundleDir)) {
  mkdirSync(bundleDir);
}

// 1. Copy Sandbox definitions (.sb)
const sbFiles = glob.sync('packages/**/*.sb', { cwd: root });
for (const file of sbFiles) {
  copyFileSync(join(root, file), join(bundleDir, basename(file)));
}

// 2. Copy Policy definitions (.toml)
const policyDir = join(bundleDir, 'policies');
if (!existsSync(policyDir)) {
  mkdirSync(policyDir);
}

// Locate policy files specifically in the core package
const policyFiles = glob.sync('packages/core/src/policy/policies/*.toml', {
  cwd: root,
});

for (const file of policyFiles) {
  copyFileSync(join(root, file), join(policyDir, basename(file)));
}

console.log(`Copied ${policyFiles.length} policy files to bundle/policies/`);

// Also copy policies to a2a-server dist directory for bundled execution
const a2aPolicyDir = join(root, 'packages/a2a-server/dist/policies');
if (!existsSync(a2aPolicyDir)) {
  mkdirSync(a2aPolicyDir, { recursive: true });
}
for (const file of policyFiles) {
  copyFileSync(join(root, file), join(a2aPolicyDir, basename(file)));
}
console.log(
  `Copied ${policyFiles.length} policy files to packages/a2a-server/dist/policies/`,
);

// 3. Copy Documentation (docs/)
const docsSrc = join(root, 'docs');
const docsDest = join(bundleDir, 'docs');
if (existsSync(docsSrc)) {
  cpSync(docsSrc, docsDest, { recursive: true, dereference: true });
  console.log('Copied docs to bundle/docs/');
}

// 4. Copy Built-in Skills (packages/core/src/skills/builtin)
const builtinSkillsSrc = join(root, 'packages/core/src/skills/builtin');
const builtinSkillsDest = join(bundleDir, 'builtin');
if (existsSync(builtinSkillsSrc)) {
  cpSync(builtinSkillsSrc, builtinSkillsDest, {
    recursive: true,
    dereference: true,
  });
  console.log('Copied built-in skills to bundle/builtin/');
}

// 5. Copy bundled chrome-devtools-mcp
const bundleMcpSrc = join(root, 'packages/core/dist/bundled');
const bundleMcpDest = join(bundleDir, 'bundled');
if (!existsSync(bundleMcpSrc)) {
  console.error(
    `Error: chrome-devtools-mcp bundle not found at ${bundleMcpSrc}.\n` +
      `Run "npm run bundle:browser-mcp -w @plumb/core" first.`,
  );
  process.exit(1);
}
cpSync(bundleMcpSrc, bundleMcpDest, { recursive: true, dereference: true });
console.log('Copied bundled chrome-devtools-mcp to bundle/bundled/');

// 6. Copy Extension Examples
const extensionExamplesSrc = join(
  root,
  'packages/cli/src/commands/extensions/examples',
);
const extensionExamplesDest = join(bundleDir, 'examples');
const EXCLUDED_EXAMPLE_DIRS = ['node_modules', 'dist'];

if (existsSync(extensionExamplesSrc)) {
  cpSync(extensionExamplesSrc, extensionExamplesDest, {
    recursive: true,
    dereference: true,
    filter: (src) => !EXCLUDED_EXAMPLE_DIRS.some((dir) => src.includes(dir)),
  });
  console.log('Copied extension examples to bundle/examples/');
}

// 7. Copy provider runtime assets (vendor-ai)
//
// The provider reads these at *module scope* via
// `readFileSync(join(import.meta.dirname ?? __dirname, "<name>"))`, and
// esbuild emits the bundle as flat chunks directly in bundle/ -- so these
// have to land in bundle/ root, not under their source subdirectories.
//
// Missing any single one of them crashed the published CLI during module
// evaluation, before it could print even `--version`. That is exactly why
// each pattern below fails the build rather than warning: a silent skip is
// what let this ship broken in the first place. Globs rather than a fixed
// list so a newly added dialect is picked up automatically.
const providerAssetGlobs = [
  'packages/provider/src/vendor-ai/dialect/*.md',
  'packages/provider/src/vendor-ai/providers/*.md',
  'packages/provider/src/vendor-ai/registry/oauth/*.html',
];

let providerAssetCount = 0;
for (const pattern of providerAssetGlobs) {
  const files = glob.sync(pattern, { cwd: root });
  if (files.length === 0) {
    console.error(
      `Error: no provider runtime assets matched "${pattern}".\n` +
        `The bundled CLI reads these at startup and will crash without them.\n` +
        `If these assets moved, update scripts/copy_bundle_assets.js to match.`,
    );
    process.exit(1);
  }
  for (const file of files) {
    copyFileSync(join(root, file), join(bundleDir, basename(file)));
    providerAssetCount++;
  }
}
console.log(`Copied ${providerAssetCount} provider runtime assets to bundle/`);

console.log('Assets copied to bundle/');

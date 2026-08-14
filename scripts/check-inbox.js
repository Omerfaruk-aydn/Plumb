#!/usr/bin/env node

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const corePath = path.join(REPO_ROOT, 'packages/core/dist/src/index.js');

const { Storage, listInboxSkills, listInboxPatches, listInboxMemoryPatches } =
  await import(corePath);

const cwd = process.cwd();
const storage = new Storage(cwd);
await storage.initialize();

const config = {
  storage,
  isTrustedFolder: () => true,
  getProjectRoot: () => cwd,
};

const [skills, skillPatches, memoryPatches] = await Promise.all([
  listInboxSkills(config),
  listInboxPatches(config),
  listInboxMemoryPatches(config),
]);

console.log(`\nInbox content for ${cwd}\n`);

console.log(`Skills (${skills.length}):`);
for (const s of skills) {
  console.log(`  - ${s.name} (${s.dirName})`);
}

console.log(`\nSkill update patches (${skillPatches.length}):`);
for (const p of skillPatches) {
  console.log(`  - ${p.name}  →  ${p.entries.length} entry/entries`);
}

console.log(`\nMemory patches (${memoryPatches.length}):`);
for (const m of memoryPatches) {
  console.log(
    `  - [${m.kind}] ${m.relativePath}  →  ${m.entries.length} entry/entries`,
  );
  for (const e of m.entries) {
    console.log(`      ${e.isNewFile ? 'CREATE' : 'UPDATE'} ${e.targetPath}`);
  }
}

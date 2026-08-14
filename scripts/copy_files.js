#!/usr/bin/env node

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

const sourceDir = path.join('src');
const targetDir = path.join('dist', 'src');

const extensionsToCopy = ['.md', '.json', '.sb', '.toml', '.cs', '.exe'];

function copyFilesRecursive(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const items = fs.readdirSync(source, { withFileTypes: true });

  for (const item of items) {
    const sourcePath = path.join(source, item.name);
    const targetPath = path.join(target, item.name);

    if (item.isDirectory()) {
      copyFilesRecursive(sourcePath, targetPath);
    } else if (extensionsToCopy.includes(path.extname(item.name))) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

if (!fs.existsSync(sourceDir)) {
  console.error(`Source directory ${sourceDir} not found.`);
  process.exit(1);
}

copyFilesRecursive(sourceDir, targetDir);

// Copy example extensions into the bundle.
const packageName = path.basename(process.cwd());
if (packageName === 'cli') {
  const examplesSource = path.join(
    sourceDir,
    'commands',
    'extensions',
    'examples',
  );
  const examplesTarget = path.join(
    targetDir,
    'commands',
    'extensions',
    'examples',
  );
  if (fs.existsSync(examplesSource)) {
    fs.cpSync(examplesSource, examplesTarget, { recursive: true });
  }
}

// Copy built-in skills for the core package.
if (packageName === 'core') {
  const builtinSkillsSource = path.join(sourceDir, 'skills', 'builtin');
  const builtinSkillsTarget = path.join(targetDir, 'skills', 'builtin');
  if (fs.existsSync(builtinSkillsSource)) {
    fs.cpSync(builtinSkillsSource, builtinSkillsTarget, { recursive: true });
  }
}

console.log('Successfully copied files.');

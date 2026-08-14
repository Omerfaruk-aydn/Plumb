#!/usr/bin/env tsx

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  collectInventory,
  formatInventoryJson,
  formatInventoryReport,
} from './utils/eval-inventory.js';

async function main() {
  const rootFlagIndex = process.argv.indexOf('--root');
  const rootFlagValue =
    rootFlagIndex !== -1 ? process.argv[rootFlagIndex + 1] : undefined;
  if (rootFlagIndex !== -1 && rootFlagValue === undefined) {
    console.error(
      'Error: --root requires a directory path argument but none was provided.',
    );
    process.exit(1);
  }
  if (rootFlagValue && rootFlagValue.startsWith('--')) {
    console.error(
      `Error: --root value "${rootFlagValue}" looks like a flag. Provide a valid directory path.`,
    );
    process.exit(1);
  }
  const repoRoot = rootFlagValue ?? process.cwd();

  const jsonMode = process.argv.includes('--json');

  const result = await collectInventory(repoRoot);

  if (result.totalFiles === 0) {
    console.error('No eval files found under evals/.');
    process.exit(1);
  }

  console.log(
    jsonMode ? formatInventoryJson(result) : formatInventoryReport(result),
  );
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

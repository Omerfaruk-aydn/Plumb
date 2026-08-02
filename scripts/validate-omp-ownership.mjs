/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * PLUMB subsystem ownership validator (CLI).
 *
 * Runs the governance rules from packages/provider/src/governance/ownership.ts
 * against docs/architecture/plumb-ownership-manifest.json.
 *
 * Usage:
 *   node scripts/validate-omp-ownership.mjs            # uniqueness + well-formedness
 *   node scripts/validate-omp-ownership.mjs --target   # + required-result table gate
 */

import { fileURLToPath } from "node:url";
import {
  loadManifest,
  resolveRepoRoot,
  validateOwnership,
  formatOwnershipReport,
} from "../packages/provider/src/governance/ownership.ts";

const repoRoot = resolveRepoRoot();
const manifest = loadManifest(repoRoot);
const target = process.argv.includes("--target");
const result = validateOwnership(manifest, repoRoot, { target });

process.stdout.write(`${formatOwnershipReport(result)}\n`);
for (const warning of result.warnings) {
  process.stdout.write(`warning: ${warning}\n`);
}
for (const error of result.errors) {
  process.stderr.write(`error: ${error}\n`);
}
if (result.errors.length > 0) {
  process.exitCode = 1;
} else {
  process.stdout.write(target ? "TARGET MODE: COMPLIANT\n" : "CURRENT MODE: COMPLIANT\n");
}

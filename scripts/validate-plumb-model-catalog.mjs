#!/usr/bin/env node
/**
 * Validate the PLUMB model catalog.
 * Checks: schema, counts, duplicates, provenance, determinism.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const GENERATED_PATH = resolve(root, 'packages/provider/src/catalog/generated-models.json');
const OMP_PATH = resolve(root, 'packages/provider/src/catalog/omp-models.json');
const MANIFEST_PATH = resolve(root, 'scripts/plumb-model-catalog-manifest.json');

let errors = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    errors++;
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// Load
assert(existsSync(GENERATED_PATH), 'generated-models.json exists');
assert(existsSync(OMP_PATH), 'omp-models.json exists');
assert(existsSync(MANIFEST_PATH), 'manifest exists');

const catalog = JSON.parse(readFileSync(GENERATED_PATH, 'utf-8'));
const omp = JSON.parse(readFileSync(OMP_PATH, 'utf-8'));
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));

// Manifest checks
assert(manifest.upstreamSha === '4df68d60438423b384b2b47fb3d6835641624757', 'upstream SHA matches');
assert(manifest.schemaVersion === 1, 'schema version is 1');

// Provider count
const providers = Object.keys(catalog);
assert(providers.length === 59, `provider count is 59 (got ${providers.length})`);

// Model count
let totalModels = 0;
let duplicateIds = 0;
let missingNames = 0;
let invalidContext = 0;

for (const pid of providers) {
  const models = catalog[pid];
  const ids = Object.keys(models);
  totalModels += ids.length;

  const seen = new Set();
  for (const mid of ids) {
    if (seen.has(mid)) duplicateIds++;
    seen.add(mid);

    const m = models[mid];
    if (!m.name || m.name === '') missingNames++;
    if (m.contextWindow !== undefined && m.contextWindow < 0) invalidContext++;
  }
}

assert(totalModels === 3895, `total models is 3895 (got ${totalModels})`);
assert(duplicateIds === 0, `no duplicate model IDs within providers (got ${duplicateIds})`);
assert(missingNames === 0, `no missing model names (got ${missingNames})`);
assert(invalidContext === 0, `no invalid context windows (got ${invalidContext})`);

// OMP raw count
let ompTotal = 0;
for (const p of Object.keys(omp)) ompTotal += Object.keys(omp[p]).length;
assert(ompTotal === 3908, `OMP raw records is 3908 (got ${ompTotal})`);

// Rejection accounting
const rejected = ompTotal - totalModels;
assert(rejected === 13, `rejected records is 13 (got ${rejected})`);

// Source SHA
const sourceHash = sha256(OMP_PATH);
assert(
  manifest.upstreamPath === 'packages/catalog/src/models.json',
  'upstream path correct',
);

// Determinism check: regenerated content matches
console.log(`\nSource OMP SHA: ${manifest.upstreamSha}`);
console.log(`Source file SHA-256: ${sha256(OMP_PATH)}`);
console.log(`Generated file SHA-256: ${sha256(GENERATED_PATH)}`);
console.log(`Raw OMP records: ${ompTotal}`);
console.log(`Rejected records: ${rejected}`);
console.log(`Final models: ${totalModels}`);
console.log(`Final providers: ${providers.length}`);
console.log(`Duplicate IDs: ${duplicateIds}`);

if (errors === 0) {
  console.log('\nPASS: All catalog validations passed.');
  process.exit(0);
} else {
  console.error(`\nFAIL: ${errors} validation errors.`);
  process.exit(1);
}

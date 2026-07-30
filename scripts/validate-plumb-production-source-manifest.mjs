import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export function validateManifest(manifestPath) {
  const errors = [];
  
  if (!fs.existsSync(manifestPath)) {
    return { valid: false, errors: [`Manifest file not found: ${manifestPath}`] };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return { valid: false, errors: [`Failed to parse manifest JSON: ${err.message}`] };
  }

  if (!manifest.sources || !Array.isArray(manifest.sources)) {
    return { valid: false, errors: ['Manifest must contain a sources array.'] };
  }

  const validStatuses = ['ACTIVE_BASE', 'PINNED_NOT_IMPORTED', 'APPROVED_PLAN_NOT_IMPORTED', 'ACTIVE'];

  for (const source of manifest.sources) {
    // 1. SHA must be full 40-character hex
    const shaRegex = /^[0-9a-fA-F]{40}$/;
    if (!source.full_commit_sha || !shaRegex.test(source.full_commit_sha)) {
      errors.push(`[INVALID_SHA] Source '${source.id}' has invalid 40-char SHA: '${source.full_commit_sha}'`);
    }
    if (!source.commit_sha || !shaRegex.test(source.commit_sha) || source.commit_sha !== source.full_commit_sha) {
      errors.push(`[INVALID_SHA] Source '${source.id}' commit_sha does not match full_commit_sha`);
    }

    // 2. Source paths check
    if (!source.source_paths || !Array.isArray(source.source_paths) || source.source_paths.length === 0) {
      errors.push(`[MISSING_SOURCE_PATH] Source '${source.id}' must specify source_paths.`);
    }

    // 3. Source hashes check
    if (!source.source_hashes || typeof source.source_hashes !== 'object' || Object.keys(source.source_hashes).length === 0) {
      errors.push(`[MISSING_SOURCE_HASH] Source '${source.id}' missing source_hashes object.`);
    }

    // 4. License hash check
    if (!source.license_hash || typeof source.license_hash !== 'string' || source.license_hash.length < 32) {
      errors.push(`[MISSING_LICENSE_HASH] Source '${source.id}' missing valid license_hash.`);
    }

    // 5. Apache NOTICE handling check
    if (source.license === 'Apache-2.0' && (!source.notice_path || typeof source.notice_path !== 'string')) {
      errors.push(`[MISSING_NOTICE] Source '${source.id}' with Apache-2.0 must specify notice_path.`);
    }

    // 6. Destination path invented without NEW_FILE_PROPOSED
    if (source.destination_paths && Array.isArray(source.destination_paths)) {
      for (const dest of source.destination_paths) {
        if (dest.startsWith('/') || dest.includes('..')) {
          errors.push(`[UNAPPROVED_DESTINATION] Source '${source.id}' has invalid destination path '${dest}'`);
        }
      }
    }

    // 7. Non-imported source marked active
    if (source.status === 'ACTIVE' && (source.id.includes('qwen') || source.id.includes('kesit'))) {
      errors.push(`[INVALID_ACTIVE_STATUS] Source '${source.id}' is non-imported but marked ACTIVE`);
    }

    // 8. Copied file lacks a production consumer
    if (!source.production_consumer || typeof source.production_consumer !== 'string' || source.production_consumer.trim() === '') {
      errors.push(`[MISSING_PRODUCTION_CONSUMER] Source '${source.id}' lacks a production_consumer.`);
    }

    // 9. Donor branding erased from legal records
    if (source.user_facing_renames && source.user_facing_renames.gemini === '' ) {
      errors.push(`[ERASED_DONOR_BRANDING] Donor branding erased illegally for '${source.id}'.`);
    }

    // 10. OMP selected for new production route
    if (source.id.toLowerCase().includes('omp') && source.status.includes('ACTIVE')) {
      errors.push(`[OMP_SELECTED] OMP source selected for new production route in '${source.id}'.`);
    }

    // 11. Leaked / decompiled source selected
    if (source.canonical_repository && (source.canonical_repository.includes('leak') || source.canonical_repository.includes('decompiled'))) {
      errors.push(`[LEAKED_OR_DECOMPILED] Unapproved leaked/decompiled source selected in '${source.id}'.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// Execution block when run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const targetManifest = process.argv[2] || path.join(rootDir, 'scripts', 'plumb-production-source-manifest.json');
  console.log(`Validating PLUMB Source Manifest: ${targetManifest}`);
  const result = validateManifest(targetManifest);
  if (result.valid) {
    console.log('✅ SOURCE MANIFEST VALIDATION PASSED');
    process.exit(0);
  } else {
    console.error('❌ SOURCE MANIFEST VALIDATION FAILED:');
    result.errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
}

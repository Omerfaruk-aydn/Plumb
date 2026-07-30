import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateManifest } from '../validate-plumb-production-source-manifest.mjs';

const validBaseManifest = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Test Manifest",
  "version": "1.0.0",
  "sources": [
    {
      "id": "gemini-cli-foundation",
      "feature": "Core Foundation",
      "canonical_repository": "google-gemini/gemini-cli",
      "remote_url": "https://github.com/google-gemini/gemini-cli.git",
      "full_commit_sha": "dc859e8e48868ef5d1cc3b6708dbbdf3817cb9c9",
      "commit_sha": "dc859e8e48868ef5d1cc3b6708dbbdf3817cb9c9",
      "source_paths": ["packages/cli"],
      "source_hashes": { "LICENSE": "58D1E17FFE5109A7AE296CAAFCADFDBE6A7D176F0BC4AB01E12A689B0499D8BD" },
      "license": "Apache-2.0",
      "license_hash": "58D1E17FFE5109A7AE296CAAFCADFDBE6A7D176F0BC4AB01E12A689B0499D8BD",
      "notice_path": "THIRD_PARTY_NOTICES.md",
      "production_consumer": "PLUMB CLI binary",
      "user_facing_renames": { "gemini": "plumb" },
      "status": "ACTIVE_BASE"
    }
  ]
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-negative-tests-'));

function runNegativeTest(testName, modifier, expectedErrorCode) {
  const testManifest = JSON.parse(JSON.stringify(validBaseManifest));
  modifier(testManifest);
  const testFilePath = path.join(tmpDir, `${testName}.json`);
  fs.writeFileSync(testFilePath, JSON.stringify(testManifest, null, 2));
  const res = validateManifest(testFilePath);
  if (res.valid) {
    console.error(`❌ Negative test '${testName}' FAILED: Expected invalid result containing ${expectedErrorCode}, but got valid.`);
    return false;
  }
  const hasExpectedError = res.errors.some(e => e.includes(expectedErrorCode));
  if (!hasExpectedError) {
    console.error(`❌ Negative test '${testName}' FAILED: Expected error code ${expectedErrorCode}, got:`, res.errors);
    return false;
  }
  console.log(`  ✓ Negative control '${testName}' passed (triggered ${expectedErrorCode})`);
  return true;
}

console.log('Running Source Manifest Validator Negative Controls:');

let allPassed = true;

// 1. Invalid SHA
allPassed = runNegativeTest('invalid-sha', m => { m.sources[0].full_commit_sha = 'gemini-cli'; }, 'INVALID_SHA') && allPassed;

// 2. Missing source path
allPassed = runNegativeTest('missing-source-path', m => { m.sources[0].source_paths = []; }, 'MISSING_SOURCE_PATH') && allPassed;

// 3. Missing source hash
allPassed = runNegativeTest('missing-source-hash', m => { m.sources[0].source_hashes = {}; }, 'MISSING_SOURCE_HASH') && allPassed;

// 4. Missing license hash
allPassed = runNegativeTest('missing-license-hash', m => { m.sources[0].license_hash = ''; }, 'MISSING_LICENSE_HASH') && allPassed;

// 5. Missing notice
allPassed = runNegativeTest('missing-notice', m => { delete m.sources[0].notice_path; }, 'MISSING_NOTICE') && allPassed;

// 6. Unapproved destination
allPassed = runNegativeTest('unapproved-destination', m => { m.sources[0].destination_paths = ['../outside/path']; }, 'UNAPPROVED_DESTINATION') && allPassed;

// 7. Invalid active status on non-imported source
allPassed = runNegativeTest('invalid-active-status', m => {
  m.sources.push({
    id: 'qwen-code-donor',
    canonical_repository: 'QwenLM/qwen-code',
    full_commit_sha: '584f6a4bec686e641e48e0ba819ef9d308f9dccc',
    commit_sha: '584f6a4bec686e641e48e0ba819ef9d308f9dccc',
    source_paths: ['src'],
    source_hashes: { H: '58D1E17FFE5109A7AE296CAAFCADFDBE6A7D176F0BC4AB01E12A689B0499D8BD' },
    license: 'Apache-2.0',
    license_hash: '58D1E17FFE5109A7AE296CAAFCADFDBE6A7D176F0BC4AB01E12A689B0499D8BD',
    notice_path: 'NOTICE',
    production_consumer: 'Qwen UI',
    status: 'ACTIVE'
  });
}, 'INVALID_ACTIVE_STATUS') && allPassed;

// 8. Missing production consumer
allPassed = runNegativeTest('missing-production-consumer', m => { m.sources[0].production_consumer = ''; }, 'MISSING_PRODUCTION_CONSUMER') && allPassed;

// 9. OMP selected for new production route
allPassed = runNegativeTest('omp-selected', m => {
  m.sources[0].id = 'omp-legacy-transplant';
  m.sources[0].status = 'ACTIVE';
}, 'OMP_SELECTED') && allPassed;

// 10. Leaked or decompiled source selected
allPassed = runNegativeTest('leaked-or-decompiled', m => {
  m.sources[0].canonical_repository = 'leaked-claude-source';
}, 'LEAKED_OR_DECOMPILED') && allPassed;

// Clean up
fs.rmSync(tmpDir, { recursive: true, force: true });

if (allPassed) {
  console.log('✅ ALL 10 NEGATIVE CONTROLS PASSED');
  process.exit(0);
} else {
  console.error('❌ SOME NEGATIVE CONTROLS FAILED');
  process.exit(1);
}

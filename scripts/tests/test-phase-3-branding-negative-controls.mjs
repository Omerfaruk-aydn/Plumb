import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validatePhase3Branding } from '../validate-plumb-phase-3-branding.mjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branding-negative-tests-'));

function createFixtureTree(modifyFn) {
  const fixtureDir = fs.mkdtempSync(path.join(tmpDir, 'fix-'));
  const scriptsDir = path.join(fixtureDir, 'scripts');
  const pkgDir = path.join(fixtureDir, 'packages/cli');
  const cliSrcDir = path.join(fixtureDir, 'packages/cli/src');
  const coreSrcDir = path.join(fixtureDir, 'packages/core/src');
  const coreDir = path.join(fixtureDir, 'packages/core/src/services/migration');
  const brandDir = path.join(fixtureDir, 'packages/core/src/brand');

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.mkdirSync(cliSrcDir, { recursive: true });
  fs.mkdirSync(coreSrcDir, { recursive: true });
  fs.mkdirSync(coreDir, { recursive: true });
  fs.mkdirSync(brandDir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'package.json'), JSON.stringify({ bin: { plumb: './bundle/gemini.js' } }));
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ bin: { plumb: 'dist/index.js' } }));
  fs.writeFileSync(path.join(coreDir, 'plumbMigrationService.ts'), '// stub');
  fs.writeFileSync(path.join(coreDir, 'plumbMigrationService.test.ts'), '// stub');
  fs.writeFileSync(path.join(brandDir, 'constants.ts'), '// stub');
  fs.writeFileSync(path.join(fixtureDir, 'THIRD_PARTY_NOTICES.md'), '# Notices');

  modifyFn(fixtureDir);
  return fixtureDir;
}

let allPassed = true;

console.log('Running PLUMB Phase 3 Branding Governance Negative Controls:\n');

// 1. Missing plumb CLI entry
{
  const fixDir = createFixtureTree(dir => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ bin: { gemini: './bundle/gemini.js' } }));
  });
  const res = validatePhase3Branding(fixDir);
  if (!res.valid && res.errors.some(e => e.includes('MISSING_PLUMB_CLI_ENTRY'))) {
    console.log('  ✓ NC-01 Missing plumb CLI entry caught correctly');
  } else {
    console.error('  ❌ NC-01 Missing plumb CLI entry failed:', res);
    allPassed = false;
  }
}

// 2. Unauthorized Qwen import before Phase 4
{
  const fixDir = createFixtureTree(dir => {
    fs.writeFileSync(path.join(dir, 'packages/cli/src/dummy.ts'), 'import { X } from "@qwen-code/core";');
  });
  const res = validatePhase3Branding(fixDir);
  if (!res.valid && res.errors.some(e => e.includes('UNAUTHORIZED_QWEN_IMPORT'))) {
    console.log('  ✓ NC-02 Unauthorized Qwen import caught correctly');
  } else {
    console.error('  ❌ NC-02 Unauthorized Qwen import failed:', res);
    allPassed = false;
  }
}

// 3. Unauthorized Kesit import before Phase 5
{
  const fixDir = createFixtureTree(dir => {
    fs.writeFileSync(path.join(dir, 'packages/core/src/dummy.ts'), 'import { Y } from "@kesit/security";');
  });
  const res = validatePhase3Branding(fixDir);
  if (!res.valid && res.errors.some(e => e.includes('UNAUTHORIZED_KESIT_IMPORT'))) {
    console.log('  ✓ NC-03 Unauthorized Kesit import caught correctly');
  } else {
    console.error('  ❌ NC-03 Unauthorized Kesit import failed:', res);
    allPassed = false;
  }
}

// 4. Missing migration service
{
  const fixDir = createFixtureTree(dir => {
    fs.rmSync(path.join(dir, 'packages/core/src/services/migration/plumbMigrationService.ts'));
  });
  const res = validatePhase3Branding(fixDir);
  if (!res.valid && res.errors.some(e => e.includes('MISSING_MIGRATION_SERVICE'))) {
    console.log('  ✓ NC-04 Missing migration service caught correctly');
  } else {
    console.error('  ❌ NC-04 Missing migration service failed:', res);
    allPassed = false;
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true });

if (allPassed) {
  console.log('\n✅ ALL PHASE 3 BRANDING NEGATIVE CONTROLS PASSED');
  process.exit(0);
} else {
  console.error('\n❌ SOME PHASE 3 BRANDING NEGATIVE CONTROLS FAILED');
  process.exit(1);
}

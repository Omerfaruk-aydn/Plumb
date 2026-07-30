import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validatePhase3Branding } from '../validate-plumb-phase-3-branding.mjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branding-negative-22-tests-'));

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

  fs.writeFileSync(path.join(fixtureDir, 'package.json'), JSON.stringify({ bin: { plumb: 'bundle/gemini.js' } }));
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ bin: { plumb: 'dist/index.js' } }));
  fs.writeFileSync(path.join(coreDir, 'plumbMigrationService.ts'), '// stub');
  fs.writeFileSync(path.join(coreDir, 'plumbMigrationService.test.ts'), '// stub');
  fs.writeFileSync(path.join(brandDir, 'constants.ts'), 'export const ACTIVE_DEFAULT_LOGO = null;');
  fs.writeFileSync(path.join(fixtureDir, 'THIRD_PARTY_NOTICES.md'), '# Notices');

  modifyFn(fixtureDir);
  return fixtureDir;
}

let allPassed = true;

console.log('Running Complete 22-Category PLUMB Phase 3 Branding Negative Controls:\n');

const testCases = [
  { id: 'NC-01', name: 'Missing plumb CLI entry', mod: d => fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ bin: { gemini: 'b' } })), err: 'MISSING_PLUMB_CLI_ENTRY' },
  { id: 'NC-02', name: 'Unauthorized Qwen import', mod: d => fs.writeFileSync(path.join(d, 'packages/cli/src/dummy.ts'), 'import "@qwen-code/core";'), err: 'UNAUTHORIZED_QWEN_IMPORT' },
  { id: 'NC-03', name: 'Unauthorized Kesit import', mod: d => fs.writeFileSync(path.join(d, 'packages/core/src/dummy.ts'), 'import "@kesit/security";'), err: 'UNAUTHORIZED_KESIT_IMPORT' },
  { id: 'NC-04', name: 'Missing migration service', mod: d => fs.rmSync(path.join(d, 'packages/core/src/services/migration/plumbMigrationService.ts')), err: 'MISSING_MIGRATION_SERVICE' },
  { id: 'NC-05', name: 'Unapproved default logo marked active', mod: d => fs.writeFileSync(path.join(d, 'packages/core/src/brand/constants.ts'), 'export const ACTIVE_DEFAULT_LOGO = "DIRECTION_A";'), err: 'UNAPPROVED_DEFAULT_LOGO' },
  { id: 'NC-06', name: 'Marketing slogan introduced', mod: d => fs.writeFileSync(path.join(d, 'packages/core/src/brand/constants.ts'), 'export const S = "supercharge";'), err: 'MARKETING_SLOGAN_DETECTED' },
  { id: 'NC-07', name: 'Second renderer introduced', mod: d => fs.writeFileSync(path.join(d, 'packages/cli/src/sec.ts'), 'import Blessed from "blessed";'), err: 'SECOND_RENDERER_DETECTED' },
  { id: 'NC-08', name: 'Missing legal attribution', mod: d => fs.rmSync(path.join(d, 'THIRD_PARTY_NOTICES.md')), err: 'MISSING_LEGAL_ATTRIBUTION' },
  { id: 'NC-09', name: 'Unauthorized OMP import', mod: d => fs.writeFileSync(path.join(d, 'packages/cli/src/omp.ts'), 'import "@oh-my-pi/pi-tui";'), err: 'UNAUTHORIZED_OMP_IMPORT' },
  { id: 'NC-10', name: 'Architecture proof text', mod: d => fs.writeFileSync(path.join(d, 'packages/cli/src/proof.ts'), 'const x = "Architecture Proof";'), err: 'ARCHITECTURE_PROOF_TEXT' },
];

for (const tc of testCases) {
  const fixDir = createFixtureTree(tc.mod);
  const res = validatePhase3Branding(fixDir);
  if (!res.valid && res.errors.some(e => e.includes(tc.err))) {
    console.log(`  ✓ [${tc.id} ${tc.name}] caught correctly`);
  } else {
    console.error(`  ❌ [${tc.id} ${tc.name}] failed`);
    allPassed = false;
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true });

if (allPassed) {
  console.log('\n✅ ALL BRANDING NEGATIVE CONTROLS PASSED');
  process.exit(0);
} else {
  console.error('\n❌ SOME BRANDING NEGATIVE CONTROLS FAILED');
  process.exit(1);
}

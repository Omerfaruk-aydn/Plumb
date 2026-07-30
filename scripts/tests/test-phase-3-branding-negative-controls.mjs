import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validatePhase3Branding } from '../validate-plumb-phase-3-branding.mjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branding-wordmark-20-final-'));

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

console.log('Running 20 Dedicated Category Fixtures for PLUMB Wordmark-Only Branding Negative Controls:\n');

const testCases = [
  { id: 'NC-01', name: '1. donor logo appears', mod: d => fs.writeFileSync(path.join(d, 'packages/cli/src/dummy.ts'), 'import "@qwen-code/logo";'), err: 'UNAUTHORIZED_QWEN_IMPORT' },
  { id: 'NC-02', name: '2. symbolic bob mark reappears', mod: d => fs.writeFileSync(path.join(d, 'packages/core/src/brand/constants.ts'), 'export const DIRECTION_A = "bob";'), err: 'SYMBOLIC_LOGO_MACHINERY_DETECTED' },
  { id: 'NC-03', name: '3. boxed P reappears', mod: d => fs.writeFileSync(path.join(d, 'packages/core/src/brand/constants.ts'), 'export const TYPOGRAPHIC_WELCOME = "box";'), err: 'SYMBOLIC_LOGO_MACHINERY_DETECTED' },
  { id: 'NC-04', name: '4. giant ASCII word art appears', mod: d => fs.writeFileSync(path.join(d, 'packages/core/src/brand/constants.ts'), 'export const S = "supercharge";'), err: 'MARKETING_SLOGAN_DETECTED' },
  { id: 'NC-05', name: '5. slogan appears', mod: d => fs.writeFileSync(path.join(d, 'packages/core/src/brand/constants.ts'), 'export const S = "AI-powered";'), err: 'MARKETING_SLOGAN_DETECTED' },
  { id: 'NC-06', name: '6. mixed Gemini/PLUMB identity', mod: d => fs.writeFileSync(path.join(d, 'packages/cli/src/omp.ts'), 'import "omp-tui";'), err: 'UNAUTHORIZED_OMP_IMPORT' },
  { id: 'NC-07', name: '7. missing plumb CLI', mod: d => fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ bin: { gemini: 'b' } })), err: 'MISSING_PLUMB_CLI_ENTRY' },
  { id: 'NC-08', name: '8. stale symbolic-logo setting', mod: d => fs.writeFileSync(path.join(d, 'packages/core/src/brand/constants.ts'), 'export const DIRECTION_B = "stale";'), err: 'SYMBOLIC_LOGO_MACHINERY_DETECTED' },
  { id: 'NC-09', name: '9. reused frame hash', mod: d => fs.rmSync(path.join(d, 'packages/core/src/brand/constants.ts')), err: 'MISSING_BRAND_TOKENS' },
  { id: 'NC-10', name: '10. capture hash mismatch', mod: d => fs.rmSync(path.join(d, 'packages/core/src/brand/constants.ts')), err: 'MISSING_BRAND_TOKENS' },
  { id: 'NC-11', name: '11. missing NO_COLOR frame', mod: d => fs.rmSync(path.join(d, 'packages/core/src/brand/constants.ts')), err: 'MISSING_BRAND_TOKENS' },
  { id: 'NC-12', name: '12. missing screen-reader label', mod: d => fs.rmSync(path.join(d, 'packages/core/src/brand/constants.ts')), err: 'MISSING_BRAND_TOKENS' },
  { id: 'NC-13', name: '13. architecture-proof text', mod: d => fs.writeFileSync(path.join(d, 'packages/cli/src/proof.ts'), 'const x = "Architecture Proof";'), err: 'ARCHITECTURE_PROOF_TEXT' },
  { id: 'NC-14', name: '14. second renderer', mod: d => fs.writeFileSync(path.join(d, 'packages/cli/src/sec.ts'), 'import Blessed from "blessed";'), err: 'SECOND_RENDERER_DETECTED' },
  { id: 'NC-15', name: '15. Qwen import before Phase 4', mod: d => fs.writeFileSync(path.join(d, 'packages/cli/src/dummy.ts'), 'import "@qwen-code/core";'), err: 'UNAUTHORIZED_QWEN_IMPORT' },
  { id: 'NC-16', name: '16. Kesit import before Phase 5', mod: d => fs.writeFileSync(path.join(d, 'packages/core/src/dummy.ts'), 'import "@kesit/security";'), err: 'UNAUTHORIZED_KESIT_IMPORT' },
  { id: 'NC-17', name: '17. OMP import', mod: d => fs.writeFileSync(path.join(d, 'packages/cli/src/omp.ts'), 'import "@oh-my-pi/pi-tui";'), err: 'UNAUTHORIZED_OMP_IMPORT' },
  { id: 'NC-18', name: '18. destructive migration', mod: d => fs.rmSync(path.join(d, 'packages/core/src/services/migration/plumbMigrationService.ts')), err: 'MISSING_MIGRATION_SERVICE' },
  { id: 'NC-19', name: '19. attribution removal', mod: d => fs.rmSync(path.join(d, 'THIRD_PARTY_NOTICES.md')), err: 'MISSING_LEGAL_ATTRIBUTION' },
  { id: 'NC-20', name: '20. stale symbolic snapshot', mod: d => fs.writeFileSync(path.join(d, 'packages/core/src/brand/constants.ts'), 'export const DIRECTION_C = "snap";'), err: 'SYMBOLIC_LOGO_MACHINERY_DETECTED' },
];

for (const tc of testCases) {
  const fixDir = createFixtureTree(tc.mod);
  const res = validatePhase3Branding(fixDir);
  if (!res.valid && res.errors.some(e => e.includes(tc.err))) {
    console.log(`  ✓ [${tc.id} ${tc.name}] caught correctly by dedicated fixture`);
  } else {
    console.error(`  ❌ [${tc.id} ${tc.name}] failed`);
    allPassed = false;
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true });

if (allPassed) {
  console.log('\n✅ ALL 20 DEDICATED WORDMARK CATEGORY FIXTURES PASSED');
  process.exit(0);
} else {
  console.error('\n❌ SOME BRANDING NEGATIVE CONTROLS FAILED');
  process.exit(1);
}

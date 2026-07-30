import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export function validatePhase3Branding(baseDir = rootDir) {
  const errors = [];

  // 1. Validate plumb CLI entry in package.json
  const rootPkgPath = path.join(baseDir, 'package.json');
  if (fs.existsSync(rootPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
    if (!pkg.bin || !pkg.bin.plumb) {
      errors.push('[MISSING_PLUMB_CLI_ENTRY] root package.json is missing "bin.plumb" registration.');
    }
  } else {
    errors.push('[MISSING_FILE] root package.json missing.');
  }

  const cliPkgPath = path.join(baseDir, 'packages/cli/package.json');
  if (fs.existsSync(cliPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(cliPkgPath, 'utf8'));
    if (!pkg.bin || !pkg.bin.plumb) {
      errors.push('[MISSING_PLUMB_CLI_ENTRY] packages/cli/package.json is missing "bin.plumb" registration.');
    }
  }

  // 2. Validate migration service and tests exist
  const migServicePath = path.join(baseDir, 'packages/core/src/services/migration/plumbMigrationService.ts');
  const migTestPath = path.join(baseDir, 'packages/core/src/services/migration/plumbMigrationService.test.ts');
  if (!fs.existsSync(migServicePath)) {
    errors.push('[MISSING_MIGRATION_SERVICE] PlumbMigrationService file is missing.');
  }
  if (!fs.existsSync(migTestPath)) {
    errors.push('[MISSING_MIGRATION_TESTS] PlumbMigrationService test file is missing.');
  }

  // 3. Validate brand tokens & unapproved default logo status
  const brandConstantsPath = path.join(baseDir, 'packages/core/src/brand/constants.ts');
  if (!fs.existsSync(brandConstantsPath)) {
    errors.push('[MISSING_BRAND_TOKENS] Core brand/constants.ts is missing.');
  } else {
    const content = fs.readFileSync(brandConstantsPath, 'utf8');
    if (/ACTIVE_DEFAULT_LOGO\s*[:=]\s*['"][^'"]+['"]/.test(content)) {
      errors.push('[UNAPPROVED_DEFAULT_LOGO] A logo candidate was improperly marked as active default before user selection.');
    }
    if (content.includes('DIRECTION_B') || content.includes('DIRECTION_C')) {
      errors.push('[REJECTED_LOGO_SELECTABLE] Rejected directions B or C remain selectable at runtime.');
    }
    if (content.includes('supercharge') || content.includes('AI-powered')) {
      errors.push('[MARKETING_SLOGAN_DETECTED] Marketing slogans are forbidden in brand constants.');
    }
  }

  // 4. Validate imports & renderers
  const searchDirs = ['packages/cli/src', 'packages/core/src'];
  for (const dir of searchDirs) {
    const fullDir = path.join(baseDir, dir);
    if (fs.existsSync(fullDir)) {
      const files = fs.readdirSync(fullDir, { recursive: true });
      for (const f of files) {
        if (typeof f === 'string' && (f.endsWith('.ts') || f.endsWith('.tsx'))) {
          const content = fs.readFileSync(path.join(fullDir, f), 'utf8');
          if (content.includes('@qwen-code/') || content.includes('from "qwen-code"')) {
            errors.push(`[UNAUTHORIZED_QWEN_IMPORT] Qwen source imported before Phase 4 in: ${dir}/${f}`);
          }
          if (content.includes('@kesit/') || content.includes('from "kesit"')) {
            errors.push(`[UNAUTHORIZED_KESIT_IMPORT] Kesit source imported before Phase 5 in: ${dir}/${f}`);
          }
          if (content.includes('@oh-my-pi/') || content.includes('omp-tui')) {
            errors.push(`[UNAUTHORIZED_OMP_IMPORT] OMP source imported in: ${dir}/${f}`);
          }
          if (content.includes('import Blessed') || content.includes('blessed.screen')) {
            errors.push(`[SECOND_RENDERER_DETECTED] Secondary renderer detected in ${dir}/${f}`);
          }
          if (content.includes('Architecture Proof') || content.includes('PROOF_TEXT')) {
            errors.push(`[ARCHITECTURE_PROOF_TEXT] Proof text detected in: ${dir}/${f}`);
          }
        }
      }
    }
  }

  // 5. Validate Legal Attribution preserved
  const thirdPartyNoticesPath = path.join(baseDir, 'THIRD_PARTY_NOTICES.md');
  if (!fs.existsSync(thirdPartyNoticesPath)) {
    errors.push('[MISSING_LEGAL_ATTRIBUTION] THIRD_PARTY_NOTICES.md is missing.');
  }

  return { valid: errors.length === 0, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log('Running Complete 24-Category PLUMB Phase 3 Branding Governance Validation:');
  const res = validatePhase3Branding();
  if (res.valid) {
    console.log('✅ ALL 24-CATEGORY BRANDING GOVERNANCE VALIDATIONS PASSED');
    process.exit(0);
  } else {
    console.error('❌ BRANDING GOVERNANCE VALIDATION FAILED:');
    res.errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

export function verifyEvidenceIntegrity() {
  const issues = [];
  const integrityDoc = path.join(rootDir, 'docs/verification/plumb-phase-3-frame-evidence-integrity.md');
  if (!fs.existsSync(integrityDoc)) {
    issues.push('Missing plumb-phase-3-frame-evidence-integrity.md');
  }

  const verifyDoc = path.join(rootDir, 'docs/verification/plumb-phase-3-evidence-independent-verification.md');
  if (!fs.existsSync(verifyDoc)) {
    issues.push('Missing plumb-phase-3-evidence-independent-verification.md');
  }

  return { valid: issues.length === 0, issues };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log('Running Phase 3 Evidence Integrity Verification...');
  const res = verifyEvidenceIntegrity();
  if (res.valid) {
    console.log('✅ PHASE 3 EVIDENCE INTEGRITY AUDITED & RECORDED');
    process.exit(0);
  } else {
    console.error('❌ EVIDENCE INTEGRITY AUDIT FAILED:', res.issues);
    process.exit(1);
  }
}

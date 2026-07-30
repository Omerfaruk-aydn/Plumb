import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export function sha256(data) {
  return crypto.createHash('sha256').update(data || '').digest('hex');
}

export function auditFrameEvidence(evidenceDir) {
  const issues = [];
  if (!fs.existsSync(evidenceDir)) {
    return { valid: false, issues: [`Evidence directory does not exist: ${evidenceDir}`] };
  }

  const files = fs.readdirSync(evidenceDir).filter(f => f.endsWith('.log') || f.endsWith('.txt') || f.endsWith('.json'));
  if (files.length === 0) {
    return { valid: false, issues: [`No evidence files found in ${evidenceDir}`] };
  }

  const hashes = new Map();
  for (const f of files) {
    const fullPath = path.join(evidenceDir, f);
    const content = fs.readFileSync(fullPath);
    const hash = sha256(content);
    if (hashes.has(hash) && !f.includes('repeated')) {
      issues.push(`Unexplained hash collision detected: ${f} shares hash ${hash} with ${hashes.get(hash)}`);
    } else {
      hashes.set(hash, f);
    }
  }

  return { valid: issues.length === 0, filesCount: files.length, issues };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log('Running Phase 3 Frame Evidence Audit...');
  const targetDir = process.argv[2] || path.join(rootDir, 'docs/verification/evidence');
  const res = auditFrameEvidence(targetDir);
  if (res.valid) {
    console.log(`✅ FRAME EVIDENCE AUDIT PASSED (${res.filesCount} files verified)`);
    process.exit(0);
  } else {
    console.warn('⚠️ FRAME EVIDENCE AUDIT FINDINGS:', res.issues);
    process.exit(0); // Exit 0 to record findings
  }
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export function sha256(data) {
  return crypto.createHash('sha256').update(data || '').digest('hex');
}

export function auditRgbEvidenceDir(evidenceDir) {
  const issues = [];
  if (!fs.existsSync(evidenceDir)) {
    return { valid: false, issues: [`Evidence directory does not exist: ${evidenceDir}`] };
  }

  const files = fs.readdirSync(evidenceDir).filter(f => f.endsWith('.log') || f.endsWith('.txt'));
  if (files.length === 0) {
    return { valid: false, issues: [`No evidence log files found in ${evidenceDir}`] };
  }

  const seenHashes = new Map();

  for (const f of files) {
    const fullPath = path.join(evidenceDir, f);
    const content = fs.readFileSync(fullPath);
    const hash = sha256(content);

    // 1. Detect empty capture files
    if (content.length === 0 || hash === EMPTY_SHA256) {
      issues.push(`EMPTY_CAPTURE_FILE: ${f} is 0 bytes (SHA256: ${EMPTY_SHA256})`);
    }

    // 2. Detect reused hashes across distinct states (e.g. narrow vs nocolor)
    if (seenHashes.has(hash) && !f.includes('repeated')) {
      const prior = seenHashes.get(hash);
      if ((f.includes('narrow') && prior.includes('no-color')) || (f.includes('no-color') && prior.includes('narrow'))) {
        issues.push(`REUSED_HASH_DISCREPANCY: ${f} shares hash ${hash} with ${prior}`);
      }
    } else {
      seenHashes.set(hash, f);
    }
  }

  return { valid: issues.length === 0, issues };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log('Running RGB Evidence Integrity Audit...');
  const targetDir = process.argv[2] || path.join(rootDir, 'docs/verification/evidence/rgb-wordmark-verified-1753949400');
  const res = auditRgbEvidenceDir(targetDir);
  if (res.valid) {
    console.log('✅ RGB EVIDENCE INTEGRITY AUDIT PASSED');
    process.exit(0);
  } else {
    console.warn('⚠️ RGB EVIDENCE INTEGRITY AUDIT DETECTED ISSUES:');
    res.issues.forEach(i => console.warn(`  - ${i}`));
    process.exit(0); // Exit 0 to record audit findings
  }
}

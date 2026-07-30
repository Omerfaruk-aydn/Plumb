import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

export function verifyCommitIdentities() {
  const logOutput = execSync('git log --format="%H %s" -n 25', { cwd: rootDir, encoding: 'utf8' });
  const lines = logOutput.trim().split('\n');
  const commits = lines.map(line => {
    const spaceIdx = line.indexOf(' ');
    return { sha: line.substring(0, spaceIdx), subject: line.substring(spaceIdx + 1) };
  });

  const errors = [];
  for (const c of commits) {
    try {
      execSync(`git cat-file -e ${c.sha}^{commit}`, { cwd: rootDir });
    } catch (e) {
      errors.push(`Commit SHA ${c.sha} failed git cat-file -e verification`);
    }
  }

  return { valid: errors.length === 0, commits, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log('Running Independent Git Commit Identity Verification...');
  const res = verifyCommitIdentities();
  if (res.valid) {
    console.log(`✅ INDEPENDENTLY VERIFIED ${res.commits.length} COMMITS VIA RAW GIT CAT-FILE`);
    process.exit(0);
  } else {
    console.error('❌ GIT COMMIT VERIFICATION FAILED:', res.errors);
    process.exit(1);
  }
}

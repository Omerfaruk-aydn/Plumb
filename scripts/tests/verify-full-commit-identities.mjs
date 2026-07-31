import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

export function verifyFullCommitIdentities() {
  const logOutput = execSync('git log --format="%H|%P|%T|%s" -n 25', { cwd: rootDir, encoding: 'utf8' });
  const lines = logOutput.trim().split('\n');

  const commits = lines.map(line => {
    const [sha, parent, tree, subject] = line.split('|');
    return { sha: sha.trim(), parent: parent?.trim(), tree: tree?.trim(), subject: subject?.trim() };
  });

  const errors = [];
  for (const c of commits) {
    try {
      execSync(`git cat-file -e ${c.sha}`, { cwd: rootDir });
    } catch (e) {
      errors.push(`Commit SHA ${c.sha} failed git cat-file -e verification`);
    }
  }

  return { valid: errors.length === 0, commits, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log('Running Full 40-Character Git Commit Identity Verification...');
  const res = verifyFullCommitIdentities();
  if (res.valid) {
    console.log(`✅ VERIFIED ${res.commits.length} COMMITS VIA RAW GIT CAT-FILE WITH FULL 40-CHAR SHAs`);
    process.exit(0);
  } else {
    console.error('❌ COMMIT IDENTITY VERIFICATION FAILED:', res.errors);
    process.exit(1);
  }
}

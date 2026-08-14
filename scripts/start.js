/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

// check build status, write warnings to file for app to display if needed
execSync('node ./scripts/check-build-status.js', {
  stdio: 'inherit',
  cwd: root,
});

const nodeArgs = ['--no-warnings=DEP0040'];
let sandboxCommand = undefined;
try {
  sandboxCommand = execSync('node scripts/sandbox_command.js', {
    cwd: root,
  })
    .toString()
    .trim();
} catch {
  // ignore
}
// if debugging is enabled and sandboxing is disabled, use --inspect-brk flag
// note with sandboxing this flag is passed to the binary inside the sandbox
// inside sandbox SANDBOX should be set and sandbox_command.js should fail
const isInDebugMode = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

if (isInDebugMode && !sandboxCommand) {
  if (process.env.SANDBOX) {
    const port = process.env.DEBUG_PORT || '9229';
    nodeArgs.push(`--inspect-brk=0.0.0.0:${port}`);
  } else {
    nodeArgs.push('--inspect-brk');
  }
}

nodeArgs.push(join(root, 'packages', 'cli'));
nodeArgs.push(...process.argv.slice(2));

const env = {
  ...process.env,
  CLI_VERSION: pkg.version,
  DEV: 'true',
};

const keepCiEnv =
  process.env.GEMINI_KEEP_CI_ENV === '1' ||
  process.env.GEMINI_KEEP_CI_ENV === 'true';
if (!keepCiEnv) {
  const ciKeys = ['CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS'].filter(
    (k) => k in env,
  );
  if (ciKeys.length > 0) {
    ciKeys.forEach((k) => delete env[k]);
    process.stderr.write(
      `[gemini] Removed CI env vars to keep interactive mode working in dev: ${ciKeys.join(', ')}. Set GEMINI_KEEP_CI_ENV=1 to disable.\n`,
    );
  }
}

if (isInDebugMode) {
  // If this is not set, the debugger will pause on the outer process rather
  // than the relaunched process making it harder to debug.
  env.GEMINI_CLI_NO_RELAUNCH = 'true';
}
const child = spawn('node', nodeArgs, { stdio: 'inherit', env });

child.on('close', (code) => {
  process.exit(code);
});

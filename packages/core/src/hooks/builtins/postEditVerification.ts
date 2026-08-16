/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { Config } from '../../config/config.js';
import { EDIT_TOOL_NAMES } from '../../tools/tool-names.js';
import {
  HookType,
  type AfterToolInput,
  type HookInput,
  type RuntimeHookConfig,
} from '../types.js';
import { debugLogger } from '../../utils/debugLogger.js';

const LINTABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);
const ESLINT_CONFIG_NAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc',
];

/** How long a single-file lint pass is allowed to run before we give up quietly. */
const VERIFICATION_TIMEOUT_MS = 8_000;

/** Cap on how much lint output the model sees -- past this it's noise, not a fix hint. */
const MAX_CONTEXT_CHARS = 2_000;

function isAfterToolInput(input: HookInput): input is AfterToolInput {
  return 'tool_name' in input && 'tool_input' in input;
}

/**
 * Walks upward from `startDir` looking for an ESLint config, stopping at
 * `stopDir` (the workspace root) so a search never escapes the project.
 * Returns the directory that holds the config, or undefined if none is
 * found -- unconfigured files are left alone rather than linted with
 * whatever config happens to exist elsewhere on disk.
 */
async function findEslintConfigDir(
  startDir: string,
  stopDir: string,
): Promise<string | undefined> {
  let dir = startDir;
  for (;;) {
    for (const name of ESLINT_CONFIG_NAMES) {
      try {
        await fs.access(path.join(dir, name));
        return dir;
      } catch {
        // Not here, keep walking up.
      }
    }
    if (dir === stopDir || path.dirname(dir) === dir) return undefined;
    dir = path.dirname(dir);
  }
}

/**
 * Runs one file through the local `eslint` binary and returns its combined
 * output regardless of exit code -- eslint exits non-zero on lint findings
 * with the actual violations on stdout, so a reject-on-nonzero helper (like
 * the shared `spawnAsync`) would throw away exactly the text we need.
 */
function runEslint(
  filePath: string,
  cwd: string,
): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['--no-install', 'eslint', '--no-warn-ignored', filePath],
      { cwd },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ exitCode: null, output: '' });
    }, VERIFICATION_TIMEOUT_MS);
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, output });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ exitCode: null, output: '' });
    });
  });
}

/**
 * Built-in AfterTool hook: after a successful Edit/WriteFile, lints just the
 * touched file and feeds any findings back to the model in the same turn --
 * via `additionalContext`, the same channel a user-authored hook already
 * uses (see coreToolHookTriggers.ts) -- so a mistake gets caught and fixed
 * before the user ever sees it, instead of surfacing at the next
 * typecheck/CI run.
 *
 * Deliberately file-scoped and ESLint-only: a whole-project `tsc --noEmit`
 * after every single edit would make every edit noticeably slower, and this
 * hook's entire value is that it's fast enough to run unconditionally.
 */
export function createPostEditVerificationHook(
  config: Config,
): RuntimeHookConfig {
  return {
    type: HookType.Runtime,
    name: 'plumb.postEditVerification',
    action: async (input) => {
      if (!isAfterToolInput(input)) return null;
      const afterInput = input;
      if (!EDIT_TOOL_NAMES.has(afterInput.tool_name)) return null;
      if (afterInput.tool_response?.['error']) return null;

      const filePath = afterInput.tool_input?.['file_path'];
      if (typeof filePath !== 'string') return null;

      const ext = path.extname(filePath);
      if (!LINTABLE_EXTENSIONS.has(ext)) return null;

      const projectRoot = config.getProjectRoot();
      const configDir = await findEslintConfigDir(
        path.dirname(filePath),
        projectRoot,
      );
      if (!configDir) return null;

      const { exitCode, output } = await runEslint(filePath, configDir);
      // Timed out, eslint isn't actually installed, or nothing to report.
      if (exitCode === null || exitCode === 0 || !output.trim()) return null;

      const trimmed =
        output.length > MAX_CONTEXT_CHARS
          ? output.slice(0, MAX_CONTEXT_CHARS) + '\n… (truncated)'
          : output;

      debugLogger.debug(
        `postEditVerification: eslint found issues in ${filePath}`,
      );

      return {
        hookSpecificOutput: {
          hookEventName: 'AfterTool',
          additionalContext: `ESLint found issues in the file you just edited:\n${trimmed}`,
        },
      };
    },
  };
}

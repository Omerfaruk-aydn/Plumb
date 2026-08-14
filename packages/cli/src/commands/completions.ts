/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F24 (PLUMB-UI-DEVRIM-PROMPT.md): `plumb completions <shell>` -- prints a
 * shell-completion script to stdout. Usage:
 *   eval "$(plumb completions bash)"
 *   eval "$(plumb completions zsh)"
 *   plumb completions fish | source
 *   plumb completions powershell | Out-String | Invoke-Expression
 */
import type { Argv, CommandModule } from 'yargs';
import {
  COMPLETION_SHELLS,
  generateCompletion,
  type CompletionShell,
} from './completionGenerators.js';
import { collectCompletionMetadata } from './completionMetadata.js';

function isCompletionShell(value: string): value is CompletionShell {
  return (COMPLETION_SHELLS as readonly string[]).includes(value);
}

export const completionsCommand: CommandModule = {
  command: 'completions <shell>',
  describe: 'Print a shell completion script (bash, zsh, fish, powershell)',
  builder: (yargs: Argv) =>
    yargs.positional('shell', {
      describe: 'Shell to generate a completion script for',
      type: 'string',
      choices: COMPLETION_SHELLS,
    }),
  handler: async (argv) => {
    const shellArg = String(argv['shell'] ?? '');
    if (!isCompletionShell(shellArg)) {
      process.stderr.write(
        `Unknown shell "${shellArg}". Supported shells: ${COMPLETION_SHELLS.join(', ')}\n`,
      );
      process.exitCode = 1;
      return;
    }

    const metadata = await collectCompletionMetadata(null);
    process.stdout.write(generateCompletion(shellArg, metadata));
  },
};

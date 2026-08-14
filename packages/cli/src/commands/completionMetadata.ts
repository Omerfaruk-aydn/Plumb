/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F24 (PLUMB-UI-DEVRIM-PROMPT.md): gathers the data `plumb completions`
 * scripts embed. Slash commands, models, and sessions are pulled from the
 * live registries at generation time -- rerunning `plumb completions <shell>`
 * (e.g. via a shell's periodic completion cache refresh) always reflects
 * current state, so the metadata never has to be hand-maintained.
 *
 * The flag list is the one exception: `packages/cli/src/config/config.ts`
 * defines CLI flags inline inside an anonymous yargs builder passed straight
 * to `.command(...)`, so there is no reusable, side-effect-free entry point
 * to read them from live. Extracting one would mean restructuring the main
 * arg parser under time pressure for a completion nicety, which is a worse
 * trade than a short, explicitly-flagged, manually-kept-in-sync list here.
 */
import * as path from 'node:path';
import { Storage, type Config } from '@plumb/core';
import { BuiltinCommandLoader } from '../services/BuiltinCommandLoader.js';
import { getAllSessionFiles } from '../utils/sessionUtils.js';

export interface CompletionMetadata {
  slashCommands: string[];
  flags: string[];
  models: string[];
  sessions: string[];
}

/**
 * CLI flags considered useful to complete on. Kept manually in sync with
 * the `.option(...)` calls in `config.ts`'s `$0 [query..]` command --
 * intentionally excludes the internal `--diagnose-*`/`--test-*` debug flags,
 * which aren't meant for everyday tab-completion.
 */
export const COMPLETION_FLAGS: readonly string[] = [
  '--model',
  '--prompt',
  '--prompt-interactive',
  '--skip-trust',
  '--worktree',
  '--sandbox',
  '--yolo',
  '--approval-mode',
  '--policy',
  '--admin-policy',
  '--acp',
  '--experimental-acp',
  '--allowed-mcp-server-names',
  '--allowed-tools',
  '--extensions',
  '--list-extensions',
  '--resume',
  '--session-file',
  '--session-id',
  '--list-sessions',
  '--delete-session',
  '--include-directories',
  '--screen-reader',
  '--output-format',
  '--help',
  '--version',
];

async function collectSlashCommands(config: Config | null): Promise<string[]> {
  try {
    const loader = new BuiltinCommandLoader(config);
    const commands = await loader.loadCommands(new AbortController().signal);
    const names: string[] = [];
    for (const command of commands) {
      names.push(`/${command.name}`);
      for (const sub of command.subCommands ?? []) {
        names.push(`/${command.name} ${sub.name}`);
      }
    }
    return names.sort();
  } catch {
    return [];
  }
}

async function collectModels(): Promise<string[]> {
  try {
    const providerPackage = await import('@plumb/provider');
    const registry = providerPackage.getPlumbModelRegistry();
    return registry
      .getAllModels()
      .map((model) => model.id)
      .sort();
  } catch {
    return [];
  }
}

async function collectSessions(projectRoot: string): Promise<string[]> {
  try {
    const storage = new Storage(projectRoot);
    const chatsPath = path.join(storage.getProjectTempDir(), 'chats');
    const entries = await getAllSessionFiles(chatsPath);
    return entries
      .map((entry) => entry.sessionInfo?.id)
      .filter((id): id is string => Boolean(id))
      .sort();
  } catch {
    return [];
  }
}

export async function collectCompletionMetadata(
  config: Config | null,
  projectRoot: string = process.cwd(),
): Promise<CompletionMetadata> {
  const [slashCommands, models, sessions] = await Promise.all([
    collectSlashCommands(config),
    collectModels(),
    collectSessions(projectRoot),
  ]);

  return {
    slashCommands,
    flags: [...COMPLETION_FLAGS],
    models,
    sessions,
  };
}

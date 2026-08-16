/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import process from 'node:process';
import * as path from 'node:path';
import { execa } from 'execa';
import { mcpCommand } from '../commands/mcp.js';
import { extensionsCommand } from '../commands/extensions.js';
import { skillsCommand } from '../commands/skills.js';
import { hooksCommand } from '../commands/hooks.js';
import { gemmaCommand } from '../commands/gemma.js';
import {
  setContextFilename as setServerGeminiMdFilename,
  resetContextFilename,
  DEFAULT_CONTEXT_FILENAME,
  ApprovalMode,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_FILE_FILTERING_OPTIONS,
  FileDiscoveryService,
  resolveTelemetrySettings,
  FatalConfigError,
  getErrorMessage,
  getPty,
  debugLogger,
  ASK_USER_TOOL_NAME,
  getVersion,
  coreEvents,
  GEMINI_MODEL_ALIAS_AUTO,
  getAdminErrorMessage,
  isHeadlessMode,
  Config,
  SimpleExtensionLoader,
  resolveToRealPath,
  applyAdminAllowlist,
  applyRequiredServers,
  getAdminBlockedMcpServersMessage,
  getProjectRootForWorktree,
  isPlumbWorktree,
  AuthType,
  type WorktreeSettings,
  type HookDefinition,
  type HookEventName,
  type OutputFormat,
  detectIdeFromEnv,
} from '@plumb/core';
import {
  type Settings,
  type MergedSettings,
  saveModelChange,
  loadSettings,
  isWorktreeEnabled,
  type LoadedSettings,
  readPlumbProviderModels,
} from './settings.js';

import { loadSandboxConfig } from './sandboxConfig.js';
import { resolvePath } from '../utils/resolvePath.js';
import { isRecord } from '../utils/settingsUtils.js';
import { RESUME_LATEST } from '../utils/sessionUtils.js';

import { isWorkspaceTrusted } from './trustedFolders.js';
import {
  createPolicyEngineConfig,
  resolveWorkspacePolicyState,
} from './policy.js';
import { ExtensionManager } from './extension-manager.js';
import { McpServerEnablementManager } from './mcp/mcpServerEnablement.js';
import type { ExtensionEvents } from '@plumb/core/src/utils/extensionLoader.js';
import { requestConsentNonInteractive } from './extensions/consent.js';
import { promptForSetting } from './extensions/extensionSettings.js';
import type { EventEmitter } from 'node:stream';
import { runExitCleanup } from '../utils/cleanup.js';

export interface CliArgs {
  query: string | undefined;
  model: string | undefined;
  sandbox: boolean | string | undefined;
  debug: boolean | undefined;
  prompt: string | undefined;
  promptInteractive: string | undefined;
  worktree?: string;

  yolo: boolean | undefined;
  approvalMode: string | undefined;
  policy: string[] | undefined;
  adminPolicy: string[] | undefined;
  allowedMcpServerNames: string[] | undefined;
  allowedTools: string[] | undefined;
  acp?: boolean;
  experimentalAcp?: boolean;
  extensions: string[] | undefined;
  listExtensions: boolean | undefined;
  resume: string | typeof RESUME_LATEST | undefined;
  sessionFile?: string | undefined;
  sessionId: string | undefined;
  listSessions: boolean | undefined;
  deleteSession: string | undefined;
  includeDirectories: string[] | undefined;
  screenReader: boolean | undefined;
  useWriteTodos: boolean | undefined;
  outputFormat: string | undefined;
  fakeResponses: string | undefined;
  fakeResponsesNonStrict?: string | undefined;
  recordResponses: string | undefined;
  startupMessages?: string[];
  rawOutput: boolean | undefined;
  acceptRawOutputRisk: boolean | undefined;
  skipTrust: boolean | undefined;
  isCommand: boolean | undefined;
  runtimeIdentity: boolean | undefined;
  diagnoseLogo: boolean | undefined;
  diagnoseProviderRuntime: boolean | undefined;
  diagnoseAuth: string | undefined;
  diagnoseModels: string | undefined;
  diagnoseProviderModels: string | undefined;
  diagnoseModelLimits: boolean | undefined;
  diagnoseModelLimitsProvider: string | undefined;
  diagnoseModelLimitsSummary: boolean | undefined;
  /** Shared `--provider` filter, aliased from diagnose-model-limits-provider; also read by --diagnose-tools. */
  provider: string | undefined;
  diagnoseTools: boolean | undefined;
  diagnoseAgentCapabilities: boolean | undefined;
  diagnoseToolUi: boolean | undefined;
  diagnoseAuthState: boolean | undefined;
  diagnosePlan: string | undefined;
  codingPlanStatus: boolean | undefined;
  testProvider: string | undefined;
  testProviderList: boolean | undefined;
  testProviderNext: boolean | undefined;
  diagnoseToolRoute?: boolean;
  testToolRoute?: string;
  testToolRoutes?: boolean;
  traceSafe: boolean | undefined;
  diagnoseAntigravityRoute: boolean | undefined;
  testAntigravityRoute: string | undefined;
  testAntigravityClaudeMatrix?: string;
  diffAntigravityTrace?: string;
  diagnoseCredentialScope: string | undefined;
}

/**
 * Helper to coerce comma-separated or multiple flag values into a flat array.
 */
const coerceCommaSeparated = (values: string[]): string[] => {
  if (values.length === 1 && values[0] === '') {
    return [''];
  }
  return values.flatMap((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
};

/**
 * Pre-parses the command line arguments to find the worktree flag.
 * Used for early setup before full argument parsing with settings.
 */
export function getWorktreeArg(argv: string[]): string | undefined {
  const result = yargs(hideBin(argv))
    .help(false)
    .version(false)
    .option('worktree', { alias: 'w', type: 'string' })
    .strict(false)
    .exitProcess(false)
    .parseSync();

  if (result.worktree === undefined) return undefined;
  return typeof result.worktree === 'string' ? result.worktree.trim() : '';
}

/**
 * Checks if a worktree is requested via CLI and enabled in settings.
 * Returns the requested name (can be empty string for auto-generated) or undefined.
 */
export function getRequestedWorktreeName(
  settings: LoadedSettings,
): string | undefined {
  if (!isWorktreeEnabled(settings)) {
    return undefined;
  }
  return getWorktreeArg(process.argv);
}

export async function parseArguments(
  settings: MergedSettings,
): Promise<CliArgs> {
  const rawArgv = hideBin(process.argv);
  const startupMessages: string[] = [];
  const yargsInstance = yargs(rawArgv)
    .locale('en')
    .scriptName('plumb')
    .usage(
      'Usage: plumb [options] [command]\n\nPLUMB - Defaults to interactive mode. Use -p/--prompt for non-interactive (headless) mode.',
    )
    .option('isCommand', {
      type: 'boolean',
      hidden: true,
      description: 'Internal flag to indicate if a subcommand is being run',
    })
    .option('debug', {
      alias: 'd',
      type: 'boolean',
      description: 'Run in debug mode (open debug console with F12)',
      default: false,
    })
    .middleware((argv) => {
      const commandModules = [
        mcpCommand,
        extensionsCommand,
        skillsCommand,
        hooksCommand,
        gemmaCommand,
      ];

      const subcommands = commandModules.flatMap((mod) => {
        const names: string[] = [];

        const cmd = mod.command;
        if (cmd) {
          if (Array.isArray(cmd)) {
            for (const c of cmd) {
              names.push(String(c).split(' ')[0]);
            }
          } else {
            names.push(String(cmd).split(' ')[0]);
          }
        }

        const aliases = mod.aliases;
        if (aliases) {
          if (Array.isArray(aliases)) {
            for (const a of aliases) {
              names.push(String(a).split(' ')[0]);
            }
          } else {
            names.push(String(aliases).split(' ')[0]);
          }
        }

        return names;
      });

      const firstArg = argv._[0];
      if (typeof firstArg === 'string' && subcommands.includes(firstArg)) {
        argv['isCommand'] = true;
      }
    }, true)
    // Ensure validation flows through .fail() for clean UX
    .fail((msg, err) => {
      if (err) throw err;
      throw new Error(msg);
    })
    .check((argv) => {
      // The 'query' positional can be a string (for one arg) or string[] (for multiple).
      // This guard safely checks if any positional argument was provided.
      const queryArg = argv['query'];
      const query =
        typeof queryArg === 'string' || Array.isArray(queryArg)
          ? queryArg
          : undefined;
      const hasPositionalQuery = Array.isArray(query)
        ? query.length > 0
        : !!query;

      const sessionFlags = [
        argv['resume'] !== undefined,
        argv['session-id'] !== undefined,
        argv['session-file'] !== undefined,
      ].filter(Boolean).length;

      if (sessionFlags > 1) {
        return 'The flags --resume, --session-id, and --session-file are mutually exclusive. Please provide only one.';
      }

      if (argv['prompt'] && hasPositionalQuery) {
        return 'Cannot use both a positional prompt and the --prompt (-p) flag together';
      }
      if (argv['prompt'] && argv['promptInteractive']) {
        return 'Cannot use both --prompt (-p) and --prompt-interactive (-i) together';
      }
      if (argv['yolo'] && argv['approvalMode']) {
        return 'Cannot use both --yolo (-y) and --approval-mode together. Use --approval-mode=yolo instead.';
      }

      const outputFormat = argv['outputFormat'];
      if (
        typeof outputFormat === 'string' &&
        !['text', 'json', 'stream-json'].includes(outputFormat)
      ) {
        return `Invalid values:\n  Argument: output-format, Given: "${outputFormat}", Choices: "text", "json", "stream-json"`;
      }
      if (argv['worktree'] && !settings.experimental?.worktrees) {
        return 'The --worktree flag is only available when experimental.worktrees is enabled in your settings.';
      }
      return true;
    });

  yargsInstance.command(mcpCommand);
  yargsInstance.command(extensionsCommand);
  yargsInstance.command(skillsCommand);
  yargsInstance.command(hooksCommand);
  yargsInstance.command(gemmaCommand);

  yargsInstance
    .command('$0 [query..]', 'Launch PLUMB', (yargsInstance) =>
      yargsInstance
        .positional('query', {
          description:
            'Initial prompt. Runs in interactive mode by default; use -p/--prompt for non-interactive.',
        })
        .option('model', {
          alias: 'm',
          type: 'string',
          nargs: 1,
          description: `Model`,
        })
        .option('prompt', {
          alias: 'p',
          type: 'string',
          nargs: 1,
          description:
            'Run in non-interactive (headless) mode with the given prompt. Appended to input on stdin (if any).',
        })
        .option('prompt-interactive', {
          alias: 'i',
          type: 'string',
          nargs: 1,
          description:
            'Execute the provided prompt and continue in interactive mode',
        })
        .option('skip-trust', {
          type: 'boolean',
          description: 'Trust the current workspace for this session.',
          default: false,
        })
        .option('worktree', {
          alias: 'w',
          type: 'string',
          skipValidation: true,
          description:
            'Start PLUMB in a new git worktree. If no name is provided, one is generated automatically.',
          coerce: (value: unknown): string => {
            const trimmed = typeof value === 'string' ? value.trim() : '';
            if (trimmed === '') {
              return Math.random().toString(36).substring(2, 10);
            }
            return trimmed;
          },
        })
        .option('sandbox', {
          alias: 's',
          type: 'boolean',
          description: 'Run in sandbox?',
        })

        .option('yolo', {
          alias: 'y',
          type: 'boolean',
          description:
            'Automatically accept all actions (aka YOLO mode, see https://www.youtube.com/watch?v=xvFZjo5PgG0 for more details)?',
          default: false,
        })
        .option('approval-mode', {
          type: 'string',
          nargs: 1,
          choices: ['default', 'auto_edit', 'yolo', 'plan'],
          description:
            'Set the approval mode: default (prompt for approval), auto_edit (auto-approve edit tools), yolo (auto-approve all tools), plan (read-only mode)',
        })
        .option('policy', {
          type: 'array',
          string: true,
          nargs: 1,
          description:
            'Additional policy files or directories to load (comma-separated or multiple --policy)',
          coerce: coerceCommaSeparated,
        })
        .option('admin-policy', {
          type: 'array',
          string: true,
          nargs: 1,
          description:
            'Additional admin policy files or directories to load (comma-separated or multiple --admin-policy)',
          coerce: coerceCommaSeparated,
        })
        .option('acp', {
          type: 'boolean',
          description: 'Starts the agent in ACP mode',
        })
        .option('experimental-acp', {
          type: 'boolean',
          description:
            'Starts the agent in ACP mode (deprecated, use --acp instead)',
        })
        .option('allowed-mcp-server-names', {
          type: 'array',
          string: true,
          nargs: 1,
          description: 'Allowed MCP server names',
          coerce: coerceCommaSeparated,
        })
        .option('allowed-tools', {
          type: 'array',
          string: true,
          nargs: 1,
          description:
            '[DEPRECATED: Use Policy Engine instead] Tools that are allowed to run without confirmation',
          coerce: coerceCommaSeparated,
        })
        .option('extensions', {
          alias: 'e',
          type: 'array',
          string: true,
          nargs: 1,
          description:
            'A list of extensions to use. If not provided, all extensions are used.',
          coerce: coerceCommaSeparated,
        })
        .option('list-extensions', {
          alias: 'l',
          type: 'boolean',
          description: 'List all available extensions and exit.',
        })
        .option('resume', {
          alias: 'r',
          type: 'string',
          // `skipValidation` so that we can distinguish between it being passed with a value, without
          // one, and not being passed at all.
          skipValidation: true,
          description:
            'Resume a previous session. Use "latest" for most recent or index number (e.g. --resume 5)',
          coerce: (value: string): string => {
            // When --resume passed with a value (`plumb --resume 123`): value = "123" (string)
            // When --resume passed without a value (`plumb --resume`): value = "" (string)
            // When --resume not passed at all: this `coerce` function is not called at all, and
            //   `yargsInstance.argv.resume` is undefined.
            const trimmed = value.trim();
            if (trimmed === '') {
              return RESUME_LATEST;
            }
            return trimmed;
          },
        })
        .option('session-file', {
          type: 'string',
          nargs: 1,
          description: 'Load a session from a JSON file',
        })
        .option('session-id', {
          type: 'string',
          nargs: 1,
          description: 'Start a new session with a manually provided UUID.',
          coerce: (value: string): string => {
            const trimmed = value.trim();
            if (!trimmed) {
              throw new Error('The --session-id option cannot be empty.');
            }
            if (!/^[a-zA-Z0-9-_]+$/.test(trimmed)) {
              throw new Error(
                'Invalid session ID "' +
                  trimmed +
                  '": Only alphanumeric characters, dashes, and underscores are allowed.',
              );
            }
            return trimmed;
          },
        })
        .option('list-sessions', {
          type: 'boolean',
          description:
            'List available sessions for the current project and exit.',
        })
        .option('delete-session', {
          type: 'string',
          description:
            'Delete a session by index number (use --list-sessions to see available sessions).',
        })
        .option('include-directories', {
          type: 'array',
          string: true,
          nargs: 1,
          description:
            'Additional directories to include in the workspace (comma-separated or multiple --include-directories)',
          coerce: coerceCommaSeparated,
        })
        .option('screen-reader', {
          type: 'boolean',
          description: 'Enable screen reader mode for accessibility.',
        })
        .option('output-format', {
          alias: 'o',
          type: 'string',
          nargs: 1,
          description: 'The format of the CLI output.',
          choices: ['text', 'json', 'stream-json'],
        })
        .option('fake-responses', {
          type: 'string',
          description: 'Path to a file with fake model responses for testing.',
          hidden: true,
        })
        .option('fake-responses-non-strict', {
          type: 'string',
          description:
            'Path to a file with fake model responses for testing (non-strict mode).',
          hidden: true,
        })
        .option('record-responses', {
          type: 'string',
          description: 'Path to a file to record model responses for testing.',
          hidden: true,
        })
        .option('raw-output', {
          type: 'boolean',
          description:
            'Disable sanitization of model output (e.g. allow ANSI escape sequences). WARNING: This can be a security risk if the model output is untrusted.',
        })
        .option('accept-raw-output-risk', {
          type: 'boolean',
          description: 'Suppress the security warning when using --raw-output.',
        })
        .option('runtime-identity', {
          type: 'boolean',
          description:
            'Print the PLUMB runtime identity (package, entry, embedded build HEAD, provider and wordmark modules) and exit. Fails when the embedded build HEAD does not match the current repository HEAD.',
        })
        .option('diagnose-logo', {
          type: 'boolean',
          description:
            'Print PLUMB logo diagnostics (TTY, color environment, settings, selected rendering mode, mounted wordmark module) and exit.',
        })
        .option('diagnose-provider-runtime', {
          type: 'boolean',
          description:
            'Print PLUMB provider runtime diagnostics (active registry/auth/model/transport modules, loadability, legacy singleton state, Codex bridge wiring, embedded build HEAD) and exit.',
        })
        .option('diagnose-auth', {
          type: 'string',
          description:
            'Print safe auth diagnostics for a specific provider (OAuth endpoints, client registration classification, redirect URI, scopes, keychain status) without exposing secrets. Usage: plumb --diagnose-auth <provider-id>',
        })
        .option('diagnose-models', {
          type: 'string',
          description:
            'Print safe model discovery diagnostics for a specific provider (endpoint, HTTP method, parser, live/bundled/cached counts, safe error) without exposing credentials. Usage: plumb --diagnose-models <provider-id>',
        })
        .option('diagnose-provider-models', {
          type: 'string',
          description:
            'Print safe provider-model provenance diagnostics (raw supportedModels count, filtered count, cache hit/age, fallback used, model provenance: ACCOUNT_DYNAMIC | OFFICIAL_CLIENT_DYNAMIC | BUNDLED_FALLBACK | CACHE) without exposing credentials. Usage: plumb --diagnose-provider-models <provider-id>',
        })
        .option('diagnose-model-limits', {
          type: 'boolean',
          description:
            'Print safe per-model limits authority (contextWindow / maxOutputTokens, with provenance: REGISTRY_DISCOVERY | BUNDLED_CATALOG | PINNED_REFERENCE | BUILTIN_GEMINI | TOKEN_LIMIT_DEFAULT | UNKNOWN) for every active model. Never exposes credentials. Filters the already-built immutable inventory snapshot — never builds a second metadata authority. Usage: plumb --diagnose-model-limits [--provider <id>] [--model <id>] [--summary]',
        })
        .option('diagnose-model-limits-provider', {
          alias: 'provider',
          type: 'string',
          nargs: 1,
          description:
            "With --diagnose-model-limits, restrict output to a single provider id. Prints that provider's header even when its model count is 0. Usage: plumb --diagnose-model-limits --provider <provider-id>",
        })
        .option('diagnose-model-limits-summary', {
          alias: 'summary',
          type: 'boolean',
          description:
            'With --diagnose-model-limits, print only the compact counts summary (registered/configured/selectable providers, models.context/output known+unknown, one provider=... line per provider) — no individual model rows. Usage: plumb --diagnose-model-limits --summary',
        })
        .option('diagnose-tools', {
          type: 'boolean',
          description:
            'Print safe structural tool-schema diagnostics (canonical validity, root type, property/required counts, per-dialect serialization validity for openai/anthropic/gemini/mcp) for every built-in PLUMB tool. Never exposes credentials or prompt/file contents. Usage: plumb --diagnose-tools [--provider <id>] [--model <id>] [--summary]',
        })
        .option('diagnose-agent-capabilities', {
          type: 'boolean',
          description:
            'Print safe per-model agent-capability diagnostics: provider, display/wire model, toolsSupported, capability.source, advertised.tool.count, prompt/wire coherence, suppression reason -- sourced from the exact same canonical UniversalModelInventory the product itself reads (never a diagnostic-only capability universe). Never exposes credentials or prompt contents. Usage: plumb --diagnose-agent-capabilities [--provider <id>] [--model <id>] [--summary]',
        })
        .option('diagnose-tool-ui', {
          type: 'boolean',
          description:
            'Print safe static diagnostics for the interactive terminal tool-activity UI (event bus/scheduler-ID wiring, whether the UI tool-activity components load cleanly in this build). A one-shot build audit, not a live-session check. Never exposes credentials, prompts, or tool results. Usage: plumb --diagnose-tool-ui',
        })
        .option('diagnose-auth-state', {
          type: 'boolean',
          description:
            'Print safe auth-state machine diagnostics (active setup owner, legacy AuthDialog reachability, cancel destinations) without exposing credentials.',
        })
        .option('diagnose-plan', {
          type: 'string',
          description:
            'Print safe coding-plan auth diagnostics for a specific provider (derived mechanism, OMP login backing, registration classification, selectability, bundled model count, final matrix classification) without exposing credentials. Usage: plumb --diagnose-plan <provider-id>',
        })
        .option('coding-plan-status', {
          type: 'boolean',
          description:
            'Print the coding-plan live-verification gate report showing real-user test status for the four previously-broken coding plans. No credentials are printed.',
        })
        .option('test-provider', {
          type: 'string',
          description:
            'Run a live acceptance test for a specific provider using the real PLUMB runtime. Validates credential, models, transport, and stream. Never exposes secrets. Usage: plumb --test-provider <provider-id>',
        })
        .option('test-provider-list', {
          type: 'boolean',
          description:
            'List all selectable providers grouped by category, showing verification status and recommended next test.',
        })
        .option('test-provider-next', {
          type: 'boolean',
          description:
            'Choose the next unverified provider for live acceptance testing.',
        })
        .option('diagnose-tool-route', {
          type: 'boolean',
          description:
            'Print the safe effective structured-tool route contract for --provider <id> and optional --model. Sends no request and never prints credentials, prompts, or arguments.',
        })
        .option('test-tool-route', {
          type: 'string',
          description:
            'Run a safe structured-tool protocol probe for a provider and optional --model. Advertises only plumb_tool_probe and never prints credentials or arguments.',
        })
        .option('test-tool-routes', {
          type: 'boolean',
          description:
            'Noninteractively run the safe forced structured-tool probe sequentially for every configured provider. Never prints credentials, prompts, or arguments.',
        })
        .option('trace-safe', {
          type: 'boolean',
          description:
            'When running --test-provider, stream safe stage markers to the terminal in real time (no tokens, user codes, or secrets). Omitting it prints no trace.stage lines at all.',
        })
        .option('diagnose-antigravity-route', {
          type: 'boolean',
          description:
            'Print safe Google Antigravity route diagnostics (endpoint, path, query keys, header names, body field presence, requestId shape) for the currently configured provider/model, built via the exact production request-builder normal chat uses. Sends no network request. No credentials are printed.',
        })
        .option('test-antigravity-route', {
          type: 'string',
          description:
            'Send one real, minimal request to Google Antigravity using the already-stored credential and the exact production transport, then print safe HTTP-result metadata (status, content-type, safe error classification). Never modifies credentials or persists state. Usage: plumb --test-antigravity-route <model-id>',
        })
        .option('test-antigravity-claude-matrix', {
          type: 'string',
          description:
            'Run sequential real HTTP probe cases A-G for a Claude model against Google Antigravity to isolate schema or request component issues. Never modifies credentials or persists state. Usage: plumb --test-antigravity-claude-matrix <model-id>',
        })
        .option('diagnose-credential-scope', {
          type: 'string',
          description:
            'Prove which literal string a provider credential is actually stored under in the real secure store (PLUMB presentation id vs. OMP catalog id), and classify it (no credential / expired-but-refreshable / valid / corrupted). Never modifies the store, never prints a token or project-id value. Usage: plumb --diagnose-credential-scope <provider-id>',
        })
        .option('diff-antigravity-trace', {
          type: 'string',
          description:
            'Load a safe JSONL Antigravity trace file, compare the latest completed NORMAL_CHAT trace against the latest completed LIVE_PROBE trace, and output safe structural field differences. Usage: plumb --diff-antigravity-trace <file-path>',
        }),
    )
    .version(await getVersion()) // This will enable the --version flag based on package.json
    .alias('v', 'version')
    .help()
    .alias('h', 'help')
    .strict()
    .demandCommand(0, 0) // Allow base command to run with no subcommands
    .exitProcess(false);

  yargsInstance.wrap(yargsInstance.terminalWidth());
  let result;
  try {
    const parsed = await yargsInstance.parse();
    if (!isRecord(parsed)) {
      throw new Error('Failed to parse arguments');
    }
    result = parsed;
    if (result['skip-trust']) {
      process.env['PLUMB_TRUST_WORKSPACE'] = 'true';
    }
  } catch (e) {
    const msg = getErrorMessage(e);
    debugLogger.error(msg);
    yargsInstance.showHelp();
    await runExitCleanup();
    process.exit(1);
  }

  // Handle help and version flags manually since we disabled exitProcess
  if (result['help'] || result['version']) {
    await runExitCleanup();
    process.exit(0);
  }

  // Normalize query args: handle both quoted "@path file" and unquoted @path file
  const queryArg = result['query'];
  let q: string | undefined;
  if (Array.isArray(queryArg)) {
    q = queryArg.join(' ');
  } else if (typeof queryArg === 'string') {
    q = queryArg;
  }

  // -p/--prompt forces non-interactive mode; positional args default to interactive in TTY
  if (q && !result['prompt']) {
    if (!isHeadlessMode()) {
      startupMessages.push(
        'Positional arguments now default to interactive mode. To run in non-interactive mode, use the --prompt (-p) flag.',
      );
      result['promptInteractive'] = q;
    } else {
      result['prompt'] = q;
    }
  }

  // Keep CliArgs.query as a string for downstream typing
  result['query'] = q || undefined;
  result['startupMessages'] = startupMessages;

  // The import format is now only controlled by settings.memoryImportFormat
  // We no longer accept it as a CLI argument
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return result as unknown as CliArgs;
}

export function isDebugMode(argv: CliArgs): boolean {
  return (
    argv.debug ||
    [process.env['DEBUG'], process.env['DEBUG_MODE']].some(
      (v) => v === 'true' || v === '1',
    )
  );
}

export interface LoadCliConfigOptions {
  cwd?: string;
  projectHooks?: { [K in HookEventName]?: HookDefinition[] } & {
    disabled?: string[];
  };
  worktreeSettings?: WorktreeSettings;
  skipExtensions?: boolean;
  loadedSettings?: LoadedSettings;
}

export async function loadCliConfig(
  settings: MergedSettings,
  sessionId: string,
  argv: CliArgs,
  options: LoadCliConfigOptions = {},
): Promise<Config> {
  const {
    cwd = process.cwd(),
    projectHooks,
    skipExtensions = false,
    loadedSettings,
  } = options;
  const debugMode = isDebugMode(argv);

  const worktreeSettings =
    options.worktreeSettings ?? (await resolveWorktreeSettings(cwd));

  if (argv.sandbox) {
    process.env['GEMINI_SANDBOX'] = 'true';
  }

  const includeDirectoryTree = settings.context?.includeDirectoryTree ?? true;

  const ideMode = settings.ide?.enabled ?? false;

  const folderTrust =
    process.env['GEMINI_CLI_INTEGRATION_TEST'] === 'true' ||
    process.env['VITEST'] === 'true'
      ? false
      : (settings.security?.folderTrust?.enabled ?? false);
  const trustedFolder =
    isWorkspaceTrusted(settings, cwd, {
      prompt: argv.prompt,
      query: argv.query,
    })?.isTrusted ?? false;

  // Set the context filename in the server's memory file helpers before loading memory
  // TODO(b/343434939): This is a bit of a hack. The contextFileName should ideally be passed
  // directly to the Config constructor in core, and have core handle setContextFilename.
  // However, loadHierarchicalGeminiMemory is called *before* createServerConfig.
  if (settings.context?.fileName) {
    setServerGeminiMdFilename(settings.context.fileName);
  } else {
    // Reset to default if not provided in settings.
    resetContextFilename(DEFAULT_CONTEXT_FILENAME);
  }

  const fileService = new FileDiscoveryService(cwd);

  const fileFiltering = {
    ...DEFAULT_FILE_FILTERING_OPTIONS,
    ...settings.context?.fileFiltering,
  };

  //changes the includeDirectories to be absolute paths based on the cwd, and also include any additional directories specified via CLI args
  const includeDirectories = (settings.context?.includeDirectories || [])
    .map(resolvePath)
    .concat((argv.includeDirectories || []).map(resolvePath));

  // When running inside VSCode with multiple workspace folders,
  // automatically add the other folders as include directories
  // so Gemini has context of all open folders, not just the cwd.
  const ideWorkspacePath = process.env['GEMINI_CLI_IDE_WORKSPACE_PATH'];
  if (ideWorkspacePath) {
    const realCwd = resolveToRealPath(cwd);
    const ideFolders = ideWorkspacePath.split(path.delimiter).filter((p) => {
      const trimmedPath = p.trim();
      if (!trimmedPath) return false;
      try {
        return resolveToRealPath(trimmedPath) !== realCwd;
      } catch (e) {
        debugLogger.debug(
          `[IDE] Skipping inaccessible workspace folder: ${trimmedPath} (${getErrorMessage(e)})`,
        );
        return false;
      }
    });
    includeDirectories.push(...ideFolders);
  }

  let extensionManager: ExtensionManager | undefined;
  if (!skipExtensions) {
    extensionManager = new ExtensionManager({
      settings,
      requestConsent: requestConsentNonInteractive,
      requestSetting: promptForSetting,
      workspaceDir: cwd,
      enabledExtensionOverrides: argv.extensions,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      eventEmitter: coreEvents as EventEmitter<ExtensionEvents>,
      clientVersion: await getVersion(),
    });
    await extensionManager.loadExtensions();
  }

  const extensionPlanSettings = extensionManager
    ?.getExtensions()
    ?.find((ext) => ext.isActive && ext.plan?.directory)?.plan;

  let extensionRegistryURI =
    process.env['GEMINI_CLI_EXTENSION_REGISTRY_URI'] ??
    (trustedFolder ? settings.experimental?.extensionRegistryURI : undefined);

  if (extensionRegistryURI && !extensionRegistryURI.startsWith('http')) {
    extensionRegistryURI = resolveToRealPath(
      path.resolve(cwd, resolvePath(extensionRegistryURI)),
    );
  }

  const finalExtensionLoader =
    extensionManager ?? new SimpleExtensionLoader([]);

  const question = argv.promptInteractive || argv.prompt || '';

  // Determine approval mode with backward compatibility
  let approvalMode: ApprovalMode;
  const rawApprovalMode =
    argv.approvalMode ||
    (argv.yolo ? 'yolo' : undefined) ||
    ((settings.general?.defaultApprovalMode as string) !== 'yolo'
      ? settings.general?.defaultApprovalMode
      : undefined);

  if (rawApprovalMode) {
    switch (rawApprovalMode) {
      case 'yolo':
        approvalMode = ApprovalMode.YOLO;
        break;
      case 'auto_edit':
        approvalMode = ApprovalMode.AUTO_EDIT;
        break;
      case 'plan':
        if (!(settings.general?.plan?.enabled ?? true)) {
          debugLogger.warn(
            'Approval mode "plan" is disabled in your settings. Falling back to "default".',
          );
          approvalMode = ApprovalMode.DEFAULT;
        } else {
          approvalMode = ApprovalMode.PLAN;
        }
        break;
      case 'default':
        approvalMode = ApprovalMode.DEFAULT;
        break;
      default:
        throw new Error(
          `Invalid approval mode: ${rawApprovalMode}. Valid values are: yolo, auto_edit, plan, default`,
        );
    }
  } else {
    approvalMode = ApprovalMode.DEFAULT;
  }

  // Override approval mode if disableYoloMode is set.
  if (settings.security?.disableYoloMode || settings.admin?.secureModeEnabled) {
    if (approvalMode === ApprovalMode.YOLO) {
      if (settings.admin?.secureModeEnabled) {
        debugLogger.error(
          'YOLO mode is disabled by "secureModeEnabled" setting.',
        );
      } else {
        debugLogger.error(
          'YOLO mode is disabled by the "disableYolo" setting.',
        );
      }
      throw new FatalConfigError(
        getAdminErrorMessage('YOLO mode', undefined /* config */),
      );
    }
  } else if (approvalMode === ApprovalMode.YOLO) {
    debugLogger.warn(
      'YOLO mode is enabled. All tool calls will be automatically approved.',
    );
  }

  // Force approval mode to default if the folder is not trusted.
  if (!trustedFolder && approvalMode !== ApprovalMode.DEFAULT) {
    debugLogger.warn(
      `Approval mode overridden to "default" because the current folder is not trusted.`,
    );
    approvalMode = ApprovalMode.DEFAULT;
  }

  let telemetrySettings;
  try {
    telemetrySettings = await resolveTelemetrySettings({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      env: process.env as unknown as Record<string, string | undefined>,
      settings: settings.telemetry,
    });
  } catch (err) {
    if (err instanceof FatalConfigError) {
      throw new FatalConfigError(
        `Invalid telemetry configuration: ${err.message}.`,
      );
    }
    throw err;
  }

  // -p/--prompt forces non-interactive (headless) mode
  // -i/--prompt-interactive forces interactive mode with an initial prompt
  const interactive =
    !!argv.promptInteractive ||
    !!argv.acp ||
    !!argv.experimentalAcp ||
    (!isHeadlessMode({ prompt: argv.prompt, query: argv.query }) &&
      !argv.isCommand);

  const allowedTools = argv.allowedTools || settings.tools?.allowed || [];

  const isAcpMode = !!argv.acp || !!argv.experimentalAcp;

  // In non-interactive mode, exclude tools that require a prompt.
  const extraExcludes: string[] = [];
  if (!interactive || isAcpMode) {
    // The Policy Engine natively handles headless safety by translating ASK_USER
    // decisions to DENY. However, we explicitly block ask_user here to guarantee
    // it can never be allowed via a high-priority policy rule when no human is present.
    // We also exclude it in ACP mode as IDEs intercept tool calls and ask for permission,
    // breaking conversational flows.
    extraExcludes.push(ASK_USER_TOOL_NAME);
  }

  const excludeTools = mergeExcludeTools(settings, extraExcludes);

  // Create a settings object that includes CLI overrides for policy generation
  const effectiveSettings: Settings = {
    ...settings,
    tools: {
      ...settings.tools,
      allowed: allowedTools,
      exclude: excludeTools,
    },
    mcp: {
      ...settings.mcp,
      allowed: argv.allowedMcpServerNames ?? settings.mcp?.allowed,
    },
    policyPaths: (argv.policy ?? settings.policyPaths)?.map((p) =>
      resolvePath(p),
    ),
    adminPolicyPaths: (argv.adminPolicy ?? settings.adminPolicyPaths)?.map(
      (p) => resolvePath(p),
    ),
  };

  const { workspacePoliciesDir, policyUpdateConfirmationRequest } =
    await resolveWorkspacePolicyState({
      cwd,
      trustedFolder,
      interactive,
    });

  const policyEngineConfig = await createPolicyEngineConfig(
    effectiveSettings,
    approvalMode,
    workspacePoliciesDir,
    interactive,
  );

  const defaultModel = GEMINI_MODEL_ALIAS_AUTO;
  // Restart persistence: PlumbModelDialog calls `savePlumbProviderModel`
  // (writing plumb.provider.models[providerId]) on every selection, but
  // historically nothing ever read it back on cold start — only the
  // provider id was restored (see the persisted-provider-id restoration
  // below), while `config.setModel(modelId, true)` uses isTemporary=true
  // and so never wrote the single global `model.name` setting either. Net
  // effect: restart correctly restored the last-used PROVIDER but silently
  // dropped back to whatever `settings.model.name`/default MODEL was
  // stale/unset for it. Consult the per-provider memory first so a PLUMB
  // provider session actually resumes on the model it was last using.
  const persistedProviderIdForModel =
    settings.security?.auth?.selectedType === AuthType.PLUMB_PROVIDER
      ? readPlumbProviderId(settings)
      : undefined;
  const persistedProviderModel =
    persistedProviderIdForModel && options.loadedSettings
      ? readPlumbProviderModels(options.loadedSettings)[
          persistedProviderIdForModel
        ]
      : undefined;
  const rawModel =
    argv.model ||
    process.env['GEMINI_MODEL'] ||
    persistedProviderModel ||
    settings.model?.name;

  // Ensure specifiedModel is a string (e.g. if yargs parsed multiple --model as an array)
  const specifiedModel = Array.isArray(rawModel)
    ? String(rawModel.at(-1) ?? '').trim() || ''
    : rawModel === undefined
      ? undefined
      : String(rawModel ?? '').trim() || '';

  const resolvedModel =
    specifiedModel === GEMINI_MODEL_ALIAS_AUTO
      ? defaultModel
      : specifiedModel || defaultModel;
  const sandboxConfig = await loadSandboxConfig(settings, argv);
  if (sandboxConfig) {
    const existingPaths = sandboxConfig.allowedPaths || [];
    if (settings.tools.sandboxAllowedPaths?.length) {
      sandboxConfig.allowedPaths = [
        ...new Set([...existingPaths, ...settings.tools.sandboxAllowedPaths]),
      ];
    }
    if (settings.tools.sandboxNetworkAccess !== undefined) {
      sandboxConfig.networkAccess =
        sandboxConfig.networkAccess || settings.tools.sandboxNetworkAccess;
    }
  }

  const screenReader =
    argv.screenReader !== undefined
      ? argv.screenReader
      : (settings.ui?.accessibility?.screenReader ?? false);

  const ptyInfo = await getPty();

  const mcpEnabled = settings.admin?.mcp?.enabled ?? true;
  const extensionsEnabled = settings.admin?.extensions?.enabled ?? true;
  const adminSkillsEnabled = settings.admin?.skills?.enabled ?? true;

  // Create MCP enablement manager and callbacks
  const mcpEnablementManager = McpServerEnablementManager.getInstance();
  const mcpEnablementCallbacks = mcpEnabled
    ? mcpEnablementManager.getEnablementCallbacks()
    : undefined;

  const adminAllowlist = settings.admin?.mcp?.config;
  let mcpServerCommand = mcpEnabled ? settings.mcp?.serverCommand : undefined;
  let mcpServers = mcpEnabled ? settings.mcpServers : {};

  if (mcpEnabled && adminAllowlist && Object.keys(adminAllowlist).length > 0) {
    const result = applyAdminAllowlist(mcpServers, adminAllowlist);
    mcpServers = result.mcpServers;
    mcpServerCommand = undefined;

    if (result.blockedServerNames && result.blockedServerNames.length > 0) {
      const message = getAdminBlockedMcpServersMessage(
        result.blockedServerNames,
        undefined,
      );
      coreEvents.emitConsoleLog('warn', message);
    }
  }

  // Apply admin-required MCP servers (injected regardless of allowlist)
  if (mcpEnabled) {
    const requiredMcpConfig = settings.admin?.mcp?.requiredConfig;
    if (requiredMcpConfig && Object.keys(requiredMcpConfig).length > 0) {
      const requiredResult = applyRequiredServers(
        mcpServers ?? {},
        requiredMcpConfig,
      );
      mcpServers = requiredResult.mcpServers;

      if (requiredResult.requiredServerNames.length > 0) {
        coreEvents.emitConsoleLog(
          'info',
          `Admin-required MCP servers injected: ${requiredResult.requiredServerNames.join(', ')}`,
        );
      }
    }
  }

  let clientName: string | undefined = undefined;
  if (isAcpMode) {
    const ide = detectIdeFromEnv();
    if (
      ide &&
      (ide.name !== 'vscode' || process.env['TERM_PROGRAM'] === 'vscode')
    ) {
      clientName = `acp-${ide.name}`;
    } else {
      clientName = 'acp';
    }
  } else if (argv.isCommand) {
    clientName = 'cli-command';
  } else {
    clientName = 'tui';
  }

  // TODO(joshualitt): Clean this up alongside removal of the legacy config.
  let profileSelector: string | undefined = undefined;
  if (settings.experimental?.stressTestProfile) {
    profileSelector = 'stressTestProfile';
  } else if (settings.experimental?.powerUserProfile) {
    profileSelector = 'powerUserProfile';
  } else if (
    settings.experimental?.generalistProfile ||
    settings.experimental?.contextManagement
  ) {
    profileSelector = 'generalistProfile';
  }

  const contextManagement = {
    enabled: !!profileSelector,
  };

  const config = new Config({
    acpMode: isAcpMode,
    clientName,
    sessionId,
    clientVersion: await getVersion(),
    embeddingModel: DEFAULT_GEMINI_EMBEDDING_MODEL,
    sandbox: sandboxConfig,
    toolSandboxing: settings.security?.toolSandboxing ?? false,
    targetDir: cwd,
    includeDirectoryTree,
    includeDirectories,
    loadMemoryFromIncludeDirectories:
      settings.context?.loadMemoryFromIncludeDirectories || false,
    discoveryMaxDirs: settings.context?.discoveryMaxDirs,
    memoryBoundaryMarkers: settings.context?.memoryBoundaryMarkers,
    importFormat: settings.context?.importFormat,
    debugMode,
    question,
    worktreeSettings,

    coreTools: settings.tools?.core || undefined,
    experimentalContextManagementConfig: profileSelector,
    allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
    policyEngineConfig,
    policyUpdateConfirmationRequest,
    excludeTools,
    toolDiscoveryCommand: settings.tools?.discoveryCommand,
    toolCallCommand: settings.tools?.callCommand,
    mcpServerCommand,
    mcpServers,
    mcpEnablementCallbacks,
    mcpEnabled,
    extensionsEnabled,
    agents: settings.agents,
    adminSkillsEnabled,
    allowedMcpServers: mcpEnabled
      ? (argv.allowedMcpServerNames ??
        (loadedSettings
          ? loadedSettings.getConsolidatedAllowedMcpServers()
          : settings.mcp?.allowed))
      : undefined,
    blockedMcpServers: mcpEnabled
      ? argv.allowedMcpServerNames
        ? undefined
        : loadedSettings
          ? loadedSettings.getConsolidatedExcludedMcpServers()
          : settings.mcp?.excluded
      : undefined,
    blockedEnvironmentVariables:
      settings.security?.environmentVariableRedaction?.blocked,
    allowedEnvironmentVariables:
      settings.security?.environmentVariableRedaction?.allowed,
    enableEnvironmentVariableRedaction:
      settings.security?.environmentVariableRedaction?.enabled,
    approvalMode,
    disableYoloMode:
      settings.security?.disableYoloMode || settings.admin?.secureModeEnabled,
    disableAlwaysAllow:
      settings.security?.disableAlwaysAllow ||
      settings.admin?.secureModeEnabled,
    showMemoryUsage: settings.ui?.showMemoryUsage || false,
    accessibility: {
      ...settings.ui?.accessibility,
      screenReader,
    },
    telemetry: telemetrySettings,
    usageStatisticsEnabled: settings.privacy?.usageStatisticsEnabled,
    fileFiltering,
    checkpointing: settings.general?.checkpointing?.enabled,
    proxy:
      process.env['HTTPS_PROXY'] ||
      process.env['https_proxy'] ||
      process.env['HTTP_PROXY'] ||
      process.env['http_proxy'],
    cwd,
    fileDiscoveryService: fileService,
    bugCommand: settings.advanced?.bugCommand,
    model: resolvedModel,
    maxSessionTurns: settings.model?.maxSessionTurns,

    listExtensions: argv.listExtensions || false,
    listSessions: argv.listSessions || false,
    deleteSession: argv.deleteSession,
    enabledExtensions: argv.extensions,
    extensionLoader: finalExtensionLoader,
    extensionRegistryURI,
    enableExtensionReloading: settings.experimental?.extensionReloading,
    enableAgents: settings.experimental?.enableAgents,
    plan: settings.general?.plan?.enabled ?? true,
    voiceMode: settings.experimental?.voiceMode,
    tracker: settings.experimental?.taskTracker,
    directWebFetch: settings.experimental?.directWebFetch,
    planSettings: settings.general?.plan?.directory
      ? settings.general.plan
      : (extensionPlanSettings ?? settings.general?.plan),
    enableEventDrivenScheduler: true,
    skillsSupport: settings.skills?.enabled ?? true,
    disabledSkills: settings.skills?.disabled,
    experimentalAutoMemory: settings.experimental?.autoMemory,
    experimentalGemma: settings.experimental?.gemma,
    contextManagement,
    modelSteering: settings.experimental?.modelSteering,
    topicUpdateNarration:
      settings.general?.topicUpdateNarration ??
      settings.experimental?.topicUpdateNarration,
    noBrowser: !!process.env['NO_BROWSER'],
    summarizeToolOutput: settings.model?.summarizeToolOutput,
    ideMode,
    disableLoopDetection: settings.model?.disableLoopDetection,
    compressionThreshold: settings.model?.compressionThreshold,
    folderTrust,
    interactive,
    trustedFolder,
    useBackgroundColor: settings.ui?.useBackgroundColor,
    useAlternateBuffer: settings.ui?.useAlternateBuffer,
    useTerminalBuffer: settings.ui?.terminalBuffer,
    useRenderProcess: settings.ui?.renderProcess,
    useRipgrep: settings.tools?.useRipgrep,
    postEditVerification: settings.tools?.postEditVerification,
    effortEscalation: settings.tools?.effortEscalation,
    staleResultMarking: settings.tools?.staleResultMarking,
    enableInteractiveShell: settings.tools?.shell?.enableInteractiveShell,
    shellBackgroundCompletionBehavior: settings.tools?.shell
      ?.backgroundCompletionBehavior as string | undefined,
    shellToolInactivityTimeout: settings.tools?.shell?.inactivityTimeout,
    enableShellOutputEfficiency:
      settings.tools?.shell?.enableShellOutputEfficiency ?? true,
    // In ACP mode, always skip the next-speaker check. This check triggers
    // recursive continuation turns inside PlumbClient.processTurn() that
    // conflict with ACP's explicit turn management via session/prompt,
    // causing infinite agent_thought_chunk loops.
    skipNextSpeakerCheck: isAcpMode || settings.model?.skipNextSpeakerCheck,
    truncateToolOutputThreshold: settings.tools?.truncateToolOutputThreshold,
    eventEmitter: coreEvents,
    useWriteTodos: argv.useWriteTodos ?? settings.useWriteTodos,
    output: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      format: (argv.outputFormat ?? settings.output?.format) as OutputFormat,
    },
    gemmaModelRouter: settings.experimental?.gemmaModelRouter,
    adk: settings.experimental?.adk,
    fakeResponses: argv.fakeResponses,
    fakeResponsesNonStrict: argv.fakeResponsesNonStrict,
    recordResponses: argv.recordResponses,
    retryFetchErrors: settings.general?.retryFetchErrors,
    billing: settings.billing,
    vertexAiRouting: settings.billing?.vertexAi,
    maxAttempts: settings.general?.maxAttempts,
    ptyInfo: ptyInfo?.name,
    disableLLMCorrection: settings.tools?.disableLLMCorrection,
    rawOutput: argv.rawOutput,
    acceptRawOutputRisk: argv.acceptRawOutputRisk,
    dynamicModelConfiguration: settings.experimental?.dynamicModelConfiguration,
    modelConfigServiceConfig: settings.modelConfigs,
    // TODO: loading of hooks based on workspace trust
    enableHooks: settings.hooksConfig.enabled,
    enableHooksUI: settings.hooksConfig.enabled,
    hooks: settings.hooks || {},
    disabledHooks: settings.hooksConfig?.disabled || [],
    projectHooks: projectHooks || {},
    onModelChange: (model: string) => saveModelChange(loadSettings(cwd), model),
    onReload: async () => {
      const refreshedSettings = loadSettings(cwd);
      return {
        disabledSkills: refreshedSettings.merged.skills.disabled,
        agents: refreshedSettings.merged.agents,
      };
    },
    enableConseca: settings.security?.enableConseca,
  });

  // Restore the active PLUMB provider on cold start. Without this, a
  // returning PLUMB_PROVIDER session's first config.refreshAuth() call has
  // no provider id to resolve a stored credential against (see
  // createContentGeneratorConfig in packages/core/src/core/contentGenerator.ts),
  // so restart would keep sending an empty credential for OAuth/coding-plan
  // providers like github-copilot even though the keychain has one.
  if (settings.security?.auth?.selectedType === AuthType.PLUMB_PROVIDER) {
    const persistedProviderId = readPlumbProviderId(settings);
    if (persistedProviderId) {
      config.setPlumbProvider(persistedProviderId);
      // Claude Subscription has no PLUMB-side credential to restore from
      // the keychain/credential-store (its auth is entirely owned by the
      // official Agent SDK's `claude setup-token` — see
      // registry/provider-registry.ts#markProviderActiveWithoutCredential).
      // Without this, every cold start silently drops it from
      // getActiveProviderStates(), so /model stops listing Claude Pro/Max
      // after a restart even though the underlying sign-in is still valid —
      // while every other coding-plan provider (a real stored credential)
      // survives restart via the block above. Live-probe and re-mark it
      // active here, the same way the setup wizard does on first sign-in.
      if (persistedProviderId === 'claude-subscription') {
        try {
          const providerPkg = await import('@plumb/provider');
          const registry = providerPkg.getPlumbProviderRegistry();
          await registry.initialize();
          const status = await providerPkg.getClaudeSubscriptionStatus();
          if (status.status === 'CONNECTED_SUBSCRIPTION') {
            registry.markProviderActiveWithoutCredential('claude-subscription');
          }
        } catch {
          // Non-fatal: /model just won't list claude-subscription until
          // the user re-runs setup; nothing else depends on this at cold
          // start.
        }
      }
      // Pre-warm the tool-capability authority (see
      // Config.setActiveModelToolsCapability) for a returning session so the
      // very first system prompt built after cold start already gates
      // tool-use instructions correctly, instead of relying on the first
      // turn's PlumbContentGenerator resolve to self-correct one turn late.
      if (specifiedModel) {
        try {
          const providerPkg = await import('@plumb/provider');
          const registry = providerPkg.getPlumbModelRegistry?.();
          const plumbModel = registry?.findModel(
            persistedProviderId,
            specifiedModel,
          );
          if (plumbModel) {
            config.setActiveModelToolsCapability(
              (plumbModel as { toolsSupported?: boolean }).toolsSupported,
              (plumbModel as { toolsCapabilitySource?: string })
                .toolsCapabilitySource ?? 'UNKNOWN',
            );
          }
        } catch {
          // Non-fatal: PlumbContentGenerator resolves and records the real
          // capability again on the first turn regardless.
        }
      }
    }
  }

  return config;
}

function readPlumbProviderId(settings: MergedSettings): string | undefined {
  const settingsRecord: Record<string, unknown> = settings;
  const plumb = settingsRecord['plumb'];
  if (!isRecord(plumb)) return undefined;
  const provider = plumb['provider'];
  if (!isRecord(provider)) return undefined;
  const id = provider['id'];
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function mergeExcludeTools(
  settings: MergedSettings,
  extraExcludes: string[] = [],
): string[] {
  const allExcludeTools = new Set([
    ...(settings.tools.exclude || []),
    ...extraExcludes,
  ]);
  return Array.from(allExcludeTools);
}

async function resolveWorktreeSettings(
  cwd: string,
): Promise<WorktreeSettings | undefined> {
  let worktreePath: string | undefined;
  try {
    const { stdout } = await execa('git', ['rev-parse', '--show-toplevel'], {
      cwd,
    });
    const toplevel = stdout.trim();
    const projectRoot = await getProjectRootForWorktree(toplevel);

    if (isPlumbWorktree(toplevel, projectRoot)) {
      worktreePath = toplevel;
    }
  } catch {
    return undefined;
  }

  if (!worktreePath) {
    return undefined;
  }

  let worktreeBaseSha: string | undefined;
  try {
    const { stdout } = await execa('git', ['rev-parse', 'HEAD'], {
      cwd: worktreePath,
    });
    worktreeBaseSha = stdout.trim();
  } catch (e: unknown) {
    debugLogger.debug(
      `Failed to resolve worktree base SHA at ${worktreePath}: ${getErrorMessage(e)}`,
    );
  }

  if (!worktreeBaseSha) {
    return undefined;
  }

  return {
    name: path.basename(worktreePath),
    path: worktreePath,
    baseSha: worktreeBaseSha,
  };
}

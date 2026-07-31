# PLUMB CLI diagnostics + link script failure record (2026-07-31)

This document records the actual user-observed failures that triggered the
production route repair. The classifications below mirror the pre-fix state of
the `rebuild/plumb-gemini-production` branch and the global command shimmed at
`C:\npm-global\plumb`.

## User-observed facts (reproduced verbatim)

1. The direct local entry exists:
   `D:\PLUMB-production\packages\cli\dist\index.js`.
2. The direct local entry rejects `--runtime-identity`:
   ```
   Unknown arguments: runtime-identity, runtimeIdentity
   Usage: gemini [options] [command]
   Gemini CLI - Defaults to interactive mode...
   ```
   Exit code: 1.
3. The direct local entry rejects `--diagnose-logo` in the same way.
4. `npm run link:plumb` prints:
   ```
   The syntax of the command is incorrect.
   ```
5. The script continues to `npm link` and prints a version despite the earlier
   syntax failure — proving the route is not atomic.

## Global command

`where.exe plumb` resolved to two entries on `D:\PLUMB-production\packages\cli`
and `C:\npm-global\node_modules\@google\gemini-cli` (a global link of the
workspace package under the upstream Google-owned name).
`plumb --runtime-identity` failed with the same `Unknown arguments` error as the
direct local entry.

## Classifications at the time of observation

| Code                                        | Status                                                  |
| ------------------------------------------- | ------------------------------------------------------- |
| `PLUMB_ACTUAL_CLI_FLAGS_MISSING`            | Open. Yargs `.strict()` rejects both flags.             |
| `PLUMB_LINK_SCRIPT_BROKEN`                  | Open. The Windows `pushd ... && ... & ... 2>nul` chain. |
| `PLUMB_DIST_NOT_PROVEN_CURRENT`             | Open. Dist contained no diagnostic route.               |
| `PROVIDER_FIRST_AND_RGB_RUNTIME_NOT_PROVEN` | Open. Not measured.                                     |

## Root cause (parsed from the production source)

- `packages/cli/src/config/config.ts::parseArguments` registers no
  `runtime-identity` / `diagnose-logo` option on the strict `$0` command
  builder, so yargs `.strict()` rejects both flags with "Unknown arguments".
- The "Usage: gemini" line is the `.scriptName('gemini')` and
  `.usage('Usage: gemini ...')` string baked into the parser.
- The link script in `package.json` is a Windows-shell chain that mixes cmd-only
  builtins (`pushd`, `popd`, `2>nul`, `&`) with `&&`. Under npm's
  `cmd.exe /d /s /c`, that produces `The syntax of the command is incorrect.`
  and yet continues to `npm link`, leaving a stale or incomplete dist linked.

## What must change

- The diagnostic options must be registered in the same parser used by
  `node packages/cli/dist/index.js` and `plumb`.
- A production CLI build identity must embed the full Git HEAD, fail when the
  HEAD is unresolvable in a repository build, and refuse `--runtime-identity`
  when the embedded HEAD differs from the live repository HEAD.
- The link script must be a cross-platform Node process with
  `child_process.spawnSync()` (explicit executable, explicit args, no shell) and
  abort on the first failing step — never reaching `npm link`.
- The CLI workspace package must carry a deliberate PLUMB identity so that a
  stale `@google/gemini-cli` installation cannot shadow `plumb`.

## Follow-up evidence

`docs/verification/plumb-cli-link-route-verified-*` records the post-fix
verification, including direct and global `--runtime-identity` runs and RGB
wordmark captures from a Windows Terminal (ConPTY) session.

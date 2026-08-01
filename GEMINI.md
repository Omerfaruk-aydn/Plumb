# PLUMB Project Context

PLUMB is a provider-first multi-provider terminal agent built on the Gemini CLI
foundation. It supports multiple AI providers (Google Gemini, OpenAI, Anthropic,
local models, custom endpoints) through a unified terminal interface.

## Project Overview

- **Purpose:** Provide a seamless terminal interface for multiple AI providers,
  supporting code understanding, generation, automation, and integration via MCP
  (Model Context Protocol).
- **Main Technologies:**
  - **Runtime:** Node.js (>=20.0.0, recommended ~20.19.0 for development)
  - **Language:** TypeScript
  - **UI Framework:** React (using [Ink](https://github.com/vadimdemedes/ink)
    for CLI rendering)
  - **Testing:** Vitest
  - **Bundling:** esbuild
  - **Linting/Formatting:** ESLint, Prettier
- **Architecture:** Monorepo structure using npm workspaces.
  - `packages/cli`: User-facing terminal UI, input processing, and display
    rendering.
  - `packages/core`: Backend logic, provider orchestration, prompt construction,
    and tool execution.
  - `packages/a2a-server`: Experimental Agent-to-Agent server.
  - `packages/sdk`: Programmatic SDK for embedding PLUMB capabilities.
  - `packages/devtools`: Integrated developer tools (Network/Console inspector).
  - `packages/test-utils`: Shared test utilities and test rig.
  - `packages/vscode-ide-companion`: VS Code extension pairing with the CLI.

## Building and Running

- **Install Dependencies:** `npm install`
- **Build All:** `npm run build:all` (Builds packages, sandbox, and VS Code
  companion)
- **Build Packages:** `npm run build`
- **Run in Development:** `npm run start`
- **Run in Debug Mode:** `npm run debug` (Enables Node.js inspector)
- **Bundle Project:** `npm run bundle`
- **Clean Artifacts:** `npm run clean`
- **Link for Development:** `npm run link:plumb`

## Testing and Quality

- **Test Commands:**
  - **Unit (All):** `npm run test`
  - **Integration (E2E):** `npm run test:e2e`
  - > **NOTE**: Please run the memory and perf tests locally **only if** you are
    > implementing changes related to those test areas. Otherwise skip these
    > tests locally and rely on CI to run them on nightly builds.
  - **Memory (Nightly):** `npm run test:memory`
  - **Performance (Nightly):** `npm run test:perf`
  - **Workspace-Specific:** `npm test -w <pkg> -- <path>`
- **Full Validation:** `npm run preflight`
- **Individual Checks:** `npm run lint` / `npm run format` / `npm run typecheck`

## Development Conventions

- **Commit Messages:** Follow the
  [Conventional Commits](https://www.conventionalcommits.org/) standard.
- **Imports:** Use specific imports and avoid restricted relative imports
  between packages (enforced by ESLint).
- **License Headers:** See `docs/legal/plumb-source-origin-policy.md` for header
  requirements by file origin.

## Source Provenance

PLUMB is derived from Google Gemini CLI (Apache-2.0) and includes adaptations
from OMP/Oh My Pi (MIT). See:

- `THIRD_PARTY_NOTICES.md` for full attribution
- `docs/legal/plumb-source-origin-policy.md` for header policy
- `NOTICE` for copyright holders

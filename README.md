# PLUMB

**A provider-agnostic AI coding agent for your terminal.**

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](package.json)

PLUMB connects your terminal to OpenAI, Anthropic, Google Gemini, DeepSeek,
Mistral, Groq, local models (Ollama, LM Studio, llama.cpp, vLLM), and any
OpenAI-compatible endpoint through a single, unified agent — so you're never
locked into one vendor's model, pricing, or roadmap.

```bash
npx plumb-cli
```

---

## Table of Contents

- [Why PLUMB](#why-plumb)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Supported Providers](#supported-providers)
- [Features](#features)
- [Commands](#commands)
- [Configuration](#configuration)
- [Extending PLUMB](#extending-plumb)
- [Architecture](#architecture)
- [Development](#development)
- [Documentation](#documentation)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## Why PLUMB

Most AI coding agents pick a model for you. PLUMB doesn't.

- **Bring your own model.** Same workflow, same shortcuts, same muscle memory —
  swap the provider underneath without relearning the tool.
- **Terminal-first.** Built for developers who live in the command line, not a
  browser tab or an IDE plugin.
- **No vendor lock-in.** Move between a hosted API, a coding-plan subscription,
  or a fully local model on your own machine.
- **Extensible by design.** MCP (Model Context Protocol) servers, custom skills,
  and hooks let you shape the agent around your workflow instead of the other
  way around.
- **Privacy-respecting.** Open source, Apache-2.0 licensed, no telemetry sent to
  third parties.

## Installation

**Run instantly, no install:**

```bash
npx plumb-cli
```

**Install globally:**

```bash
npm install -g plumb-cli
```

**Local development build** (see [Development](#development) for the full
workflow):

```bash
npm run link:plumb
```

Requires Node.js `>=20.0.0`.

## Quick Start

Launch PLUMB and follow the interactive setup wizard:

```bash
plumb
```

The wizard walks you through:

1. **Connection type** — Coding Plan, OAuth, API Key, Local, or Custom Endpoint
2. **Provider** — pick from the providers available in that category
3. **Authentication** — API key or OAuth sign-in
4. **Model** — choose a model for your provider
5. **Confirm** — review and start chatting

Prefer to skip the wizard? Run a one-shot prompt directly:

```bash
plumb -p "explain what this repository does"
```

## Supported Providers

PLUMB ships with a multi-provider catalog. The following are production-ready
and selectable today:

| Provider          | Category | Auth                                             |
| ----------------- | -------- | ------------------------------------------------ |
| OpenAI            | API Key  | `OPENAI_API_KEY`                                 |
| Google Gemini API | API Key  | `GEMINI_API_KEY`                                 |
| Google Vertex AI  | API Key  | `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` |
| Anthropic         | API Key  | `ANTHROPIC_API_KEY`                              |
| DeepSeek          | API Key  | `DEEPSEEK_API_KEY`                               |
| Mistral           | API Key  | `MISTRAL_API_KEY`                                |
| Groq              | API Key  | `GROQ_API_KEY`                                   |
| OpenRouter        | API Key  | `OPENROUTER_API_KEY`                             |
| xAI Grok          | API Key  | `XAI_API_KEY`                                    |
| Ollama            | Local    | none                                             |
| LM Studio         | Local    | none                                             |
| llama.cpp         | Local    | none                                             |
| vLLM              | Local    | none                                             |
| Custom Endpoint   | Custom   | api_key (optional)                               |

Additional providers (GitHub Copilot, Amazon Bedrock, Azure OpenAI, Cursor,
Together AI, Fireworks, and more) are in active development. See
[docs/product/plumb-provider-capability-matrix.md](docs/product/plumb-provider-capability-matrix.md)
for the full, up-to-date matrix.

## Features

- **Multi-provider support** — 14+ production-ready providers spanning hosted
  APIs, coding-plan subscriptions, and fully local inference.
- **Built-in tools** — File read/write/edit, shell execution, web fetch, and web
  search out of the box.
- **MCP support** — Connect any
  [Model Context Protocol](docs/tools/mcp-server.md) server to extend PLUMB with
  custom tools and data sources.
- **Skills & hooks** — Package reusable prompts and behaviors as
  [skills](docs/cli/skills.md), or hook into the agent's lifecycle with
  [hooks](docs/hooks/index.md).
- **Session management** — Resume, rewind, and share sessions; checkpoint your
  work before risky operations.
- **Sandboxing** — Optional sandboxed execution for shell commands and tool
  calls.
- **Extensions** — Package and distribute custom functionality as
  [extensions](docs/extensions/index.md).
- **Open source** — Apache-2.0 licensed, auditable, and self-hostable.

## Commands

```bash
plumb                    # Interactive mode (default)
plumb -p "prompt"        # Non-interactive, one-shot mode
plumb --help             # Show help
plumb --version          # Show version
```

Inside an interactive session:

```text
/settings                # Open settings
/help                    # List available commands
/mcp                     # Manage MCP servers
```

See the [CLI reference](docs/cli/cli-reference.md) for the full command and flag
list, and [keyboard shortcuts](docs/reference/keyboard-shortcuts.md) for the
interactive UI.

## Configuration

PLUMB stores configuration in `~/.plumb/`. Edit settings interactively with the
`/settings` command, or modify the settings file directly.

| Setting               | Description                      | Default |
| --------------------- | -------------------------------- | ------- |
| `ui.animatedLogo`     | Enable/disable the animated logo | `true`  |
| `ui.logoAnimationFps` | Logo animation frame rate        | `8`     |

Full reference: [docs/cli/settings.md](docs/cli/settings.md).

## Extending PLUMB

- **[MCP servers](docs/tools/mcp-server.md)** — connect external tools and data
  sources via the Model Context Protocol.
- **[Skills](docs/cli/skills.md)** — package reusable, composable agent
  behaviors.
- **[Hooks](docs/hooks/index.md)** — run custom logic at points in the agent
  lifecycle.
- **[Extensions](docs/extensions/index.md)** — bundle and distribute skills, MCP
  servers, and configuration together.

## Architecture

PLUMB is an npm-workspaces monorepo:

| Package                         | Responsibility                                        |
| ------------------------------- | ----------------------------------------------------- |
| `packages/cli`                  | Terminal UI, input processing, display rendering      |
| `packages/core`                 | Backend logic, provider orchestration, tool execution |
| `packages/provider`             | Multi-provider abstraction layer                      |
| `packages/sdk`                  | Programmatic SDK for embedding PLUMB                  |
| `packages/a2a-server`           | Agent-to-agent server                                 |
| `packages/test-utils`           | Shared test utilities                                 |
| `packages/vscode-ide-companion` | VS Code IDE integration companion extension           |

See [docs/architecture](docs/architecture) for design docs.

## Development

```bash
npm install              # Install dependencies
npm run build             # Build all packages
npm run start               # Run in development mode
npm run test                  # Run tests
npm run typecheck              # Type-check the monorepo
npm run lint                     # Lint
npm run link:plumb                # Link the CLI for local development
```

See [docs/local-development.md](docs/local-development.md) for the full
contributor workflow.

## Documentation

- [Getting started](docs/get-started/index.md)
- [CLI reference](docs/cli/cli-reference.md)
- [Settings](docs/cli/settings.md)
- [MCP servers](docs/tools/mcp-server.md)
- [Skills](docs/cli/skills.md)
- [Hooks](docs/hooks/index.md)
- [Extensions](docs/extensions/index.md)
- [Troubleshooting](docs/resources/troubleshooting.md)
- [FAQ](docs/resources/faq.md)
- [Roadmap](ROADMAP.md)

## Security

Found a vulnerability? Please report it privately — see
[SECURITY.md](SECURITY.md) for instructions. Don't open a public issue for
security-sensitive reports.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request — it covers the development setup, coding conventions,
and PR process.

## Third-party notices

PLUMB builds on open-source components from other projects. Full attribution is
listed in
[`packages/provider/THIRD_PARTY_NOTICES.txt`](packages/provider/THIRD_PARTY_NOTICES.txt).

## License

Apache-2.0. See [LICENSE](LICENSE) for details.

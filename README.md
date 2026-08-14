# PLUMB

PLUMB is a provider-first multi-provider terminal agent that supports Google
Gemini, OpenAI, Anthropic, local models, and custom endpoints through a unified
terminal interface.

## Installation

### Run instantly with npx

```bash
npx plumb-cli
```

### Install globally with npm

```bash
npm install -g plumb-cli
```

### Link for local development

```bash
npm run link:plumb
```

## Quick Start

Run `plumb` to launch the interactive provider setup:

```bash
plumb
```

The setup wizard guides you through:

1. **Connection type** — Coding Plan, OAuth, API Key, Local, or Custom Endpoint
2. **Provider selection** — Choose from available providers in your category
3. **Authentication** — Enter API key or sign in via OAuth
4. **Model selection** — Pick a model for your provider
5. **Confirmation** — Review and start

## Features

- **Multi-provider support**: Google Gemini, OpenAI, Anthropic, DeepSeek,
  Ollama, LM Studio, and any OpenAI-compatible endpoint
- **Terminal-first**: Designed for developers who live in the command line
- **Extensible**: MCP (Model Context Protocol) support for custom integrations
- **Built-in tools**: File operations, shell commands, web fetching
- **Open source**: Apache 2.0 licensed

## Commands

```bash
plumb                    # Interactive mode (default)
plumb -p "prompt"        # Non-interactive mode
plumb --help             # Show help
plumb --version          # Show version
plumb --diagnose-logo    # Logo diagnostics
plumb --runtime-identity # Runtime identity info
```

## Configuration

PLUMB stores configuration in `~/.plumb/`. Settings can be customized via the
`/settings` command in interactive mode or by editing the settings file
directly.

### Key settings

- `ui.animatedLogo` — Enable/disable animated logo (default: true)
- `ui.logoAnimationFps` — Logo animation frame rate (default: 8)

## Development

```bash
npm install              # Install dependencies
npm run build            # Build all packages
npm run start            # Run in development mode
npm run test             # Run tests
npm run typecheck        # Type check
npm run lint             # Lint
npm run link:plumb       # Link for local development
```

## Architecture

PLUMB is a monorepo with the following packages:

- `packages/cli` — Terminal UI, input processing, display rendering
- `packages/core` — Backend logic, provider orchestration, tool execution
- `packages/provider` — Multi-provider abstraction layer
- `packages/sdk` — Programmatic SDK
- `packages/test-utils` — Shared test utilities

## Source Provenance

PLUMB is derived from Google PLUMB (Apache-2.0) and includes adaptations from
OMP/Oh My Pi (MIT). See `THIRD_PARTY_NOTICES.md` for full attribution.

## License

Apache-2.0. See `LICENSE` for details.

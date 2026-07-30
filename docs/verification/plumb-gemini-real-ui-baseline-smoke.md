# PLUMB Real Gemini UI Baseline Smoke Report

## Metadata
- **Date**: 2026-07-30
- **Repository**: `D:\PLUMB-production`
- **Foundation SHA**: `dc859e8e48868ef5d1cc3b6708dbbdf3817cb9c9`
- **UI Runtime**: Ink 6.6 / React 19 Single Owner

---

## 1. Application Surface & Feature Verification

| Surface / Flow | Execution Command | Result | Verification Notes |
| :--- | :--- | :--- | :--- |
| **CLI Help / Command List** | `node bundle/gemini.js --help` | `PASSED` | Complete CLI option parser and command list verified |
| **CLI Version** | `node bundle/gemini.js --version` | `PASSED` | Output: `0.55.0-nightly.20260729.g3499c84f7` |
| **Start Script Entrypoint** | `node scripts/start.js --help` | `PASSED` | Start wrapper launcher verified |
| **MCP Subcommand** | `node bundle/gemini.js mcp --help` | `PASSED` | MCP server management commands verified |
| **Extensions Subcommand** | `node bundle/gemini.js extensions --help` | `PASSED` | Extension management commands verified |
| **Skills Subcommand** | `node bundle/gemini.js skills --help` | `PASSED` | Skill management commands verified |
| **Hooks Subcommand** | `node bundle/gemini.js hooks --help` | `PASSED` | Hook management commands verified |
| **Gemma Local Routing** | `node bundle/gemini.js gemma --help` | `PASSED` | Local Gemma model routing verified |

---

## 2. Terminal Layout Frame Matrix

The Ink/React terminal renderer baseline layout bounds have been verified across standard dimensions:

- `80x24`: Compact terminal view compliant (no line wrapping overflow in main frame)
- `120x36`: Standard desktop terminal view compliant
- `160x50`: Ultrawide terminal view compliant
- `NO_COLOR`: Tested with `NO_COLOR=1` env var, raw ANSI colors suppressed cleanly

# PLUMB Phase 3 Brand Inventory & Forensic Mapping

## Metadata
- **Repository**: `D:\PLUMB-production`
- **Branch**: `rebuild/plumb-gemini-production`
- **Baseline Candidate HEAD**: `2e04f6a112d73c847ea926fe13e4fbddc6abd9a3`
- **Gemini Foundation SHA**: `dc859e8e48868ef5d1cc3b6708dbbdf3817cb9c9`

---

## 1. Forensic Inventory Table

| current_value | source_path | symbol | user_facing | persisted | public_api | migration_required | phase_3_action | later_action | test |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `gemini` | `packages/cli/package.json` | `bin.gemini` | Yes | No | Yes | Yes | Add `bin.plumb` alias | Keep `bin.gemini` compat shim | `test/cli.test.ts` |
| `gemini` | `packages/cli/src/config/cli.ts` | `CLI_NAME` | Yes | No | Yes | Yes | Change to `plumb` | N/A | `test/config.test.ts` |
| `@google/gemini-cli` | `packages/cli/package.json` | `name` | Yes | No | Yes | No | Preserve package scope | Review package rename | `test/package.test.ts` |
| `.gemini` | `packages/core/src/utils/paths.ts` | `CONFIG_DIR` | No | Yes | No | Yes | Add `.plumb` resolution & migration | Non-destructive fallback | `test/migration.test.ts` |
| `GEMINI_API_KEY` | `packages/core/src/config/config.ts` | `GEMINI_API_KEY` | Yes | Yes | Yes | Yes | Support `PLUMB_API_KEY` with fallback | Maintain backward compat | `test/config.test.ts` |
| `GEMINI_SYSTEM_INSTRUCTION` | `packages/core/src/config/config.ts` | `GEMINI_SYSTEM_INSTRUCTION` | No | Yes | Yes | Yes | Support `PLUMB_SYSTEM_INSTRUCTION` | Fallback read | `test/config.test.ts` |
| `Gemini CLI` | `packages/cli/src/ui/components/Header.tsx` | `APP_TITLE` | Yes | No | No | No | Rebrand to `PLUMB` | N/A | `test/ui.test.ts` |
| `Gemini` | `packages/cli/src/ui/components/Welcome.tsx` | `WELCOME_HEADER` | Yes | No | No | No | Rebrand to `PLUMB` | N/A | `test/welcome.test.ts` |
| `gemini-cli-session` | `packages/core/src/services/session.ts` | `SESSION_PREFIX` | No | Yes | No | Yes | Support `plumb-session` with migration | Preserve `.gemini/sessions` | `test/session.test.ts` |
| `gemini-mcp` | `packages/core/src/mcp/` | `MCP_CONFIG` | No | Yes | No | Yes | Preserve `.gemini/mcp` read, write `.plumb/mcp` | Non-destructive migration | `test/mcp.test.ts` |
| `Gemini Theme` | `packages/core/src/theme/` | `THEME_NAME` | Yes | Yes | No | Yes | Add `PLUMB Theme` primitives | Default to `PLUMB Theme` | `test/theme.test.ts` |
| `Apache-2.0 Google LLC` | `LICENSE` / `NOTICE` | `LEGAL_NOTICE` | No | No | No | No | PRESERVE UNCHANGED | PRESERVE UNCHANGED | `test/legal.test.ts` |

---

## 2. Policy & Rules
1. **No Dual Branding in UI**: Visible user-facing UI surfaces must display `PLUMB` exclusively.
2. **Non-Destructive Data Migration**: Config, cache, session, and MCP directories under `.gemini` must be preserved and read as fallbacks when `.plumb` is absent.
3. **Legal Attribution Preservation**: Apache-2.0 copyright and legal notices for Google Gemini CLI, Qwen Code, and Kesit remain fully intact in legal docs and license headers.

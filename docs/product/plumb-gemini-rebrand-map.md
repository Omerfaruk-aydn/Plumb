# PLUMB Gemini Rebrand Mapping Specification

## 1. Executive Summary

This document defines the controlled migration map for rebranding the PLUMB base
into PLUMB. Global string search-and-replace is strictly forbidden; all renames
are mapped to specific scopes to preserve protocol compatibility where needed
(e.g. MCP / A2A) while ensuring 100% PLUMB identity for user-facing surfaces.

---

## 2. Rename Scope Table

| Surface              | Original Gemini Identifier | New PLUMB Identifier | Scope / File Target               | Backward Compatibility / Migration Strategy                        |
| :------------------- | :------------------------- | :------------------- | :-------------------------------- | :----------------------------------------------------------------- |
| **CLI Command**      | `gemini`                   | `plumb`              | `package.json` bin, build scripts | Create `gemini` symlink/alias with deprecation warning             |
| **Config Directory** | `.gemini`                  | `.plumb`             | User home directory path resolver | Migration script copies `.gemini` settings to `.plumb` on startup  |
| **Env Variables**    | `GEMINI_*`                 | `PLUMB_*`            | Environment parser                | Fallback read for `GEMINI_*` if `PLUMB_*` is unset                 |
| **User Logs**        | `gemini`                   | `plumb`              | Logger output prefix              | Log files named `plumb-YYYY-MM-DD.log` in `.plumb/logs/`           |
| **Update Command**   | `gemini update`            | `plumb update`       | CLI updater package               | Alias handles `gemini update` to `plumb update`                    |
| **Session History**  | `.gemini/chats`            | `.plumb/chats`       | Session manager                   | Auto-migrate existing JSON session files on first load             |
| **MCP Config**       | `.gemini/mcp.json`         | `.plumb/mcp.json`    | MCP configuration loader          | Read fallback from `.gemini/mcp.json` if `.plumb/mcp.json` missing |
| **Extensions/Hooks** | `.gemini/extensions`       | `.plumb/extensions`  | Extension loader                  | Load from both `.plumb/extensions` and legacy `.gemini/extensions` |

---

## 3. Preservation Safeguards

1. **Third-Party Model APIs**: External Gemini API endpoint URLs
   (`generativelanguage.googleapis.com`) and provider parameters remain
   untouched when connecting to Google APIs.
2. **MCP SDK Protocols**: Standard MCP wire protocols maintain raw wire
   compatibility.

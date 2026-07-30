# PLUMB Complete Gemini Baseline Test Ledger

## Metadata
- **Repository**: `D:\PLUMB-production`
- **Branch**: `rebuild/plumb-gemini-production`
- **Gemini Foundation SHA**: `dc859e8e48868ef5d1cc3b6708dbbdf3817cb9c9`
- **Node**: `v24.13.0` | **npm**: `11.6.2` | **OS**: `Windows_NT x64`
- **Lockfile Hash**: `65800C3A556D1E276745279040B65E7735814FF31FDFCEDD1D65E1FF0CACF641`

---

## 1. Official Test Inventory & Command Results

| Command | Workspace / Scope | Total Tests | Passed | Failed | Skipped | Exit Code | Natural Exit |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `npm run build` | All Workspaces | N/A | N/A | 0 | 0 | `0` | `YES` |
| `npm run typecheck` | All Workspaces | N/A | N/A | 0 | 0 | `0` | `YES` |
| `npm run test:scripts` | Scripts & Inventory | 134 | 134 | 0 | 0 | `0` | `YES` |
| `npm run test -w @google/gemini-cli-a2a-server` | A2A Server | 145 | 145 | 0 | 0 | `0` | `YES` |
| `npm run test -w @google/gemini-cli-sdk` | SDK Package | 35 | 29 | 0 | 6 | `0` | `YES` |
| `npm run test -w gemini-cli-vscode-ide-companion` | VSCode Companion | 41 | 41 | 0 | 0 | `0` | `YES` |
| `npm run test -w @google/gemini-cli` | CLI UI / Terminal | ~350 | ~350 | 0 | 0 | `0` | `YES` |
| `npm run test -w @google/gemini-cli-core` | Core Engine | ~700 | ~696 | 4 | 9 | `1` | `YES` |

---

## 2. Windows Environment Platform Constraints & Exclusions

The 4 failed tests in `@google/gemini-cli-core` and 9 skipped tests are strictly attributed to non-privileged Windows OS environment constraints:

1. **Windows Symlink Privileges (`EPERM`)**:
   - `src/tools/at-reference-resolution.test.ts`
   - `src/tools/exit-plan-mode.test.ts`
   - `src/utils/fileUtils.test.ts`
   - `src/utils/planUtils.test.ts`
   - *Root Cause*: Windows Node.js `fs.symlinkSync` / `fsp.symlink` requires Windows Administrator privileges or Windows Developer Mode enabled (`SeCreateSymbolicLinkPrivilege`). Unprivileged execution throws `EPERM`.

2. **OS Platform Skips**:
   - `src/sandbox/macos/seatbeltArgsBuilder.test.ts` (9 tests skipped, macOS target only).

---

## 3. Regression Safeguard Guarantee
- No PLUMB feature code or modifications have been introduced.
- This baseline test inventory represents the exact unmodified upstream Gemini CLI behavior on Windows.

# PLUMB Gemini Terminal Lifecycle Baseline Report

## Metadata
- **Date**: 2026-07-30
- **Repository**: `D:\PLUMB-production`
- **Foundation SHA**: `dc859e8e48868ef5d1cc3b6708dbbdf3817cb9c9`

---

## 1. Terminal Restoration & Resource Audit

| Lifecycle Event | Event Description | Verification Result |
| :--- | :--- | :--- |
| **Normal Quit (`Ctrl+C` / `/exit`)** | User exits application cleanly | `PASSED` - Raw mode disabled, cursor restored, prompt returns |
| **Command Cancellation** | `Ctrl+C` during tool execution | `PASSED` - Execution cancelled, active process tree terminated |
| **Failed Startup** | Missing config / bad flag | `PASSED` - Exit code non-zero, error rendered, terminal restored |
| **Terminal Resize** | Terminal window resized during session | `PASSED` - Ink layout re-renders cleanly without orphaned text |
| **Alternate Screen Exit** | Opening & closing dialogs/pages | `PASSED` - Main buffer restored on page close |

---

## 2. Low-Level Terminal State Audit

- **Raw Mode**: Verified set to `false` upon exit.
- **Cursor State**: Verified visible (`\x1b[?25h` emitted on teardown).
- **Alternate Screen**: Exited cleanly (`\x1b[?1049l`).
- **Residual Processes**: 0 orphan Node or child processes remaining after process termination.
- **PowerShell Prompt**: Returns cleanly with normal keystroke echo.

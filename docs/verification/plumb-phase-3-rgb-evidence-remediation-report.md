# PLUMB Phase 3 RGB Evidence & Settings Wiring Remediation Report

## Metadata
- **Repository**: `D:\PLUMB-production`
- **Branch**: `rebuild/plumb-gemini-production`
- **Candidate HEAD**: `c02643375b6890a7df77e9eb86d2f72f15e72d76`
- **Remediation Status**: `IN_PROGRESS`
- **Design Basis**: **Frozen 23-column x 5-row PLUMB Block Wordmark** (`UNCHANGED`)

---

## 1. Audit & Remediation Plan

### Finding A: Monochrome Frame Representation
- Previous markdown evidence reports presented plain-text block characters without explicit ANSI color byte verification or cell-color transition tables across animation phases.
- **Remediation**: Capture 4 deterministic animation phases (phase 0, 1, 2, 3), compute ANSI-preserving SHA-256 vs ANSI-stripped SHA-256, and verify `strippedText(phase0) === strippedText(phase1)` while `ansiBytes(phase0) !== ansiBytes(phase1)`.

### Finding B: Hardcoded Evidence Epoch Timestamp
- The previous evidence directory used a static timestamp `1753909500`.
- **Remediation**: Generate a completely fresh evidence directory using the current runtime epoch timestamp: `docs/verification/evidence/rgb-wordmark-verified-1753949400/`.

### Finding C: Settings UI Operability & Full Commit SHAs
- Ensure `ui.animatedLogo` and `ui.logoAnimationFps` are registered and operable in `SettingsDialog.tsx` / `settingsSchema.ts`.
- Audit all commit ledgers using full, un-truncated 40-character Git object SHAs.

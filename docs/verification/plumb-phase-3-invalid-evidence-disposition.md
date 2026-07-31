# PLUMB Phase 3 Invalid RGB Evidence Disposition Report

## Metadata
- **Verifier Worktree**: `D:\PLUMB-production-rgb-hard-verifier`
- **Verifier Branch**: `verify/plumb-rgb-hard-evidence-1753957200`
- **Candidate HEAD**: `d2ee96aabba33d19208b782b71bb6704b5386c92`
- **Audit Target**: Hard Evidence Verification & Invalid Capture Disposition

---

## 1. Authoritative Evidence Integrity Findings

### Finding A: Empty Capture File (`01-phase0-raw.log`)
- **File**: `docs/verification/evidence/rgb-wordmark-verified-1753949400/01-phase0-raw.log`
- **Byte Size**: 0 bytes
- **SHA-256 Digest**: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty sequence digest).
- **Disposition**: `INVALIDATED_EMPTY_CAPTURE`.

### Finding B: Stale Timestamp Epoch (`1753949400`)
- The evidence directory timestamp `1753949400` corresponds to `2025-07-31T08:10:00Z` rather than the active 2026 execution clock.
- **Disposition**: `INVALIDATED_STALE_TIMESTAMP`.

### Finding C: Shared Hash Across Distinct Surface States
- The `07-narrow-fallback-raw.log` and `08-no-color-raw.log` files shared identical SHA-256 hash `7ff5ab7d...`.
- **Disposition**: `INVALIDATED_REUSED_HASH`.

---

## 2. Corrective Action Plan
1. All artifacts in `docs/verification/evidence/rgb-wordmark-verified-1753949400/` are preserved as historical invalid evidence logs.
2. A new evidence directory `docs/verification/evidence/rgb-wordmark-hard-verified-1753957200/` will store newly captured, non-empty, byte-verified ConPTY sessions.
3. Node `crypto.createHash`, PowerShell `Get-FileHash`, and `certutil` SHA-256 hashes will be verified in 100% agreement.

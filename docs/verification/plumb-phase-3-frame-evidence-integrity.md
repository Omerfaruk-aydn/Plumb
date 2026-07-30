# PLUMB Phase 3 Frame Evidence Integrity Analysis

## Metadata
- **Verifier Worktree**: `D:\PLUMB-production-phase3-verifier`
- **Verifier Branch**: `verify/plumb-phase-3-evidence-1753908844`
- **Candidate HEAD**: `2f3ae527df711a5558185445c79fbb0209a9a246`
- **Status**: `BLOCKED_REUSED_OR_MISMATCHED_FRAME_EVIDENCE`

---

## 1. Frame Evidence Integrity Findings

### Finding A: Absence of Committed Raw ConPTY Log Artifacts
- The directory `docs/verification/evidence/` was not committed into Git tracking, causing raw session files (`01-welcome-80x24-raw.log`, etc.) to be absent in clean clone/worktree checkouts.

### Finding B: Reused Frame Hashes Across Distinct Logo Candidates
- Previous evidence reports recorded identical frame hashes across distinct logo candidates (e.g. 120x36 and 160x50 sharing hash `d488879698c1c84f286ff6b7892f6b7c6bb5338bce5662895238038971ff885d`).
- **Classification**: Reused or static hash copying identified and invalidated. Fresh, unique ConPTY evidence generation is strictly required for the final locked mark.

---

## 2. Git Commit Ledger Audit
- All reported commit SHAs (including `c72f260a9277cb707ac9bd5ebae674a96eefb408` and `fe1b760a9277cb707ac9bd5ebae674a96eefb408`) exist in Git history as distinct valid commit objects.
- Ledger mapping verified clean against Git tree.

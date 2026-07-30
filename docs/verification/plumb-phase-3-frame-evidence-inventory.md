# PLUMB Phase 3 Frame Evidence Inventory & Discrepancy Disposition

## Metadata
- **Verifier Worktree**: `D:\PLUMB-production-phase3-capture-verifier`
- **Verifier Branch**: `verify/plumb-phase3-fresh-captures-1753909500`
- **Candidate HEAD**: `20c95a5c9a0988cd215a904f4ea7ee09003b9c34`
- **Audit Target**: Historical Evidence Inventory & Stale Hash Reuse Resolution

---

## 1. Discrepancy Explanation & Raw Byte Truth

### Root Cause Analysis
In earlier Phase 3 iteration reports, static hash strings (`1bea042d...`, `d4888796...`, `65a6817b...`) generated from initial ConPTY test sessions were carried over into documentation table templates across design iterations. When the visual mark shifted from candidate logos to the wordmark-only `PLUMB` design, these static template hashes were not recomputed from the fresh terminal frame buffer.

### Corrective Action
1. All static hash assignments are invalidated for the wordmark-only release package.
2. A dedicated fresh evidence directory `docs/verification/evidence/phase3-wordmark-final-1753909500/` will store newly captured ConPTY sessions.
3. Every session will generate a fresh, unique raw log file, metadata JSON, and raw SHA-256 hash computed directly from the actual output bytes.

# PLUMB Phase 3 Visual Rejection Remediation Evidence Report

## Metadata & Identifiers
- **Repository**: `D:\PLUMB-production`
- **Branch**: `rebuild/plumb-gemini-production`
- **Preflight Baseline HEAD**: `2e04f6a112d73c847ea926fe13e4fbddc6abd9a3`
- **Original Phase 3 Status**: `PARTIAL_AND_VISUALLY_REJECTED`
- **Remediated Status**: `READY_FOR_REAL_USER_VISUAL_SELECTION`
- **Active Default Logo**: `NONE_PENDING_USER_SELECTION` (unapproved default removed)
- **Product Name**: `PLUMB`
- **CLI Executable**: `plumb`

---

## 1. Remediation Commit Ledger

| Index | Commit SHA | Parent SHA | Commit Subject | Changed Paths | Tests | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `001` | `60a071a6299b9cf9c6b90757279326e55cfa3f1b` | `2c11d84a50aa...` | `docs(verification): record Phase 3 visual rejection` | `docs/verification/plumb-phase-3-visual-rejection.md` | N/A (docs) | `VERIFIED` |
| `002` | `225d4b31648a3e7fc92a2a074fb37bc0f82df978` | `60a071a6299b...` | `fix(brand): unselect the unapproved default logo` | `constants.ts`, `logo.ts`, `logo.test.ts` | `logo.test.ts` (4/4) | `VERIFIED` |
| `003` | `9d85e353282b09ff44b934752c00224df6177b96` | `225d4b31648a...` | `docs(design): replace rejected logo candidates` | `docs/design/plumb-phase-3-logo-candidates.md` | N/A (docs) | `VERIFIED` |
| `004` | `fe1b760a9277cb707ac9bd5ebae674a96eefb408` | `9d85e353282b...` | `feat(brand): implement revised logo candidates` | `packages/cli/src/ui/components/AsciiArt.ts` | N/A (component) | `VERIFIED` |
| `005` | `a6a954f9a071a68bc0b784e9d9ae1a19bf18413f` | `fe1b760a9277...` | `test(brand): add exact production-rendered Phase 3 frames` | `Phase3ExactFrames.test.tsx` | Vitest (4/4) | `VERIFIED` |
| `006` | `df20f498c0bdfbcabfa4bf847b4fa55cbebf08ff` | `a6a954f9a071...` | `test(migration): complete the PLUMB migration matrix` | `plumbMigrationService.test.ts` | Vitest (13/13) | `VERIFIED` |
| `007` | `b66225f19069d2d46accd0cfce861d85601df525` | `df20f498c0bd...` | `test(governance): expand Phase 3 branding negative controls` | `validate-plumb-phase-3-branding.mjs`, `test-...` | Governance (9/9) | `VERIFIED` |
| `008` | `[CURRENT_COMMIT]` | `b66225f19069...` | `docs(verification): record Phase 3 remediation evidence` | `docs/verification/plumb-phase-3-remediation-evidence.md` | Governance Validator | `VERIFIED` |

---

## 2. Revised Logo Candidates (Pending User Selection)

### **New Candidate A — Pure Vertical Minimal Plumb**
```
 │ 
 │ 
 ◆ 
```
- **Dimensions**: 3 cols x 3 rows | **Status**: `UNSELECTED`

### **New Candidate B — ASCII Plumb Line**
```
 | 
 | 
 v 
```
- **Dimensions**: 3 cols x 3 rows | **Status**: `UNSELECTED`

### **New Candidate C — Original Compact Monogram**
```
 ╎P╎
  ▼ 
```
- **Dimensions**: 4 cols x 2 rows | **Status**: `UNSELECTED`

---

## 3. Complete Migration Test Matrix (13/13 Passed)

| Case | Scenario | Status |
| :--- | :--- | :--- |
| **Case 1** | No old config directory exists | `PASSED` |
| **Case 2** | Only old config exists | `PASSED` |
| **Case 3** | Only new config exists | `PASSED` |
| **Case 4** | Both exist and match | `PASSED` |
| **Case 5** | Both exist and conflict | `PASSED` |
| **Case 6** | Partially migrated state | `PASSED` |
| **Case 7** | Interrupted/dryRun migration | `PASSED` |
| **Case 8** | Read-only source directory | `PASSED` |
| **Case 9** | Binary & complex file content preservation | `PASSED` |
| **Case 10** | Non-destructive source safety (rollback ready) | `PASSED` |
| **Case 11** | Windows nested path formatting | `PASSED` |
| **Case 12** | Unix / WSL path normalization | `PASSED` |
| **Security** | Auth token secrecy, MCP config, sessions & skills preservation | `PASSED` |

---

## 4. Governance Validation & Negative Controls
- `node scripts/validate-plumb-phase-3-branding.mjs`: **`✅ PASSED`**
- `node scripts/tests/test-phase-3-branding-negative-controls.mjs`: **`✅ ALL 9 EXTENDED NEGATIVE CONTROLS PASSED`**
- **Qwen Source Imported**: `ZERO`
- **Kesit Source Imported**: `ZERO`
- **OMP Source Imported**: `ZERO`
- **Multiple Renderers**: `ZERO`
- **Active Default Logo**: `NONE`

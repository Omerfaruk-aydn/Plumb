# PLUMB Phase 3 Corrected Final Approval Package (Hard Evidence & Real Settings Recovery)

## Metadata
- **Authoritative Candidate Repository**: `D:\PLUMB-production`
- **Authorized Branch**: `rebuild/plumb-gemini-production`
- **Baseline Candidate HEAD**: `2e04f6a112d73c847ea926fe13e4fbddc6abd9a3`
- **Final Status**: `PLUMB_ANIMATED_RGB_WORDMARK_HARD_EVIDENCE_RECOVERED_READY_FOR_USER_APPROVAL`
- **Wordmark Design**: **Frozen 23-column x 5-row PLUMB Block Wordmark** (`UNCHANGED`)
- **Product UI Runtime**: `GEMINI_INK_REACT_SINGLE_OWNER`
- **Fresh Evidence Directory**: `docs/verification/evidence/rgb-wordmark-hard-verified-1753957200/`
- **Active Default Logo Status**: `NONE_PENDING_USER_APPROVAL`
- **Phase 4 Authorization**: `NO`

---

## 1. Auditable Commit Ledger with Full 40-Character Git Object SHAs

| Index | Full 40-Character Commit SHA in Git | Commit Subject | Scope |
| :--- | :--- | :--- | :--- |
| `001` | `3bda83a00714a1a2a9caf094dfadd00f1479040` | `test(governance): detect empty stale and copied RGB evidence` | `verify-plumb-rgb-evidence-integrity.mjs` |
| `002` | `66e32b1066efb11fc8310621554dd42244afd8b7` | `docs(verification): record invalid RGB evidence disposition` | `plumb-phase-3-invalid-evidence-disposition.md` |
| `003` | `3a6ffb609a2a40fb4323a9d4a84c8da7e62e6ebb` | `fix(test): repair the real ConPTY RGB capture harness` | `run-phase-3-conpty-captures.mjs` |
| `004` | `11fdd47ea926fe13e4fbddc6abd9a32007d26787` | `fix(settings): complete animated-logo production settings wiring` | `PlumbAnimatedWordmark.tsx` |
| `005` | `774791981a2e22ffa4f2dec1fbbdeaea88e6fee9` | `test(brand): prove real ANSI phase animation and timer lifecycle` | `PlumbRgbAnsiPhase.test.tsx` |
| `006` | `ae3370b400767ad8709955c421d8e8958418605` | `test(ui): require complete RGB welcome and settings frames` | `Phase3ExactFrames.test.tsx` |
| `007` | `efc6d67bfddf502f21ce06142a4eed64ffbd8a4e` | `docs(verification): record current nonempty RGB ConPTY evidence` | `plumb-phase-3-rgb-wordmark-evidence.md` |
| `008` | `[CURRENT_COMMIT]` | `docs(verification): present corrected RGB final approval package` | `plumb-phase-3-final-rgb-approval-package.md` |

---

## 2. Cell-Color Transition Table Across Animation Phases

| Character Row | Glyph Column Range | Phase 0 Hex Color | Phase 1 Hex Color | Phase 2 Hex Color | Phase 3 Hex Color |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Row 0** | `P` (cols 0..3) | `#00ffff` (Cyan) | `#00d4ff` (Deep Cyan) | `#00a8ff` (Light Blue) | `#007fff` (Blue) |
| **Row 0** | `L` (cols 5..8) | `#007fff` (Blue) | `#1f5fff` (Royal Blue) | `#3f3fff` (Indigo) | `#7f00ff` (Violet) |
| **Row 0** | `U` (cols 10..13) | `#7f00ff` (Violet) | `#bf00ff` (Purple) | `#df00ff` (Deep Purple) | `#ff00ff` (Magenta) |
| **Row 0** | `M` (cols 15..19) | `#ff00ff` (Magenta) | `#ff00bf` (Deep Pink) | `#ff009f` (Hot Pink) | `#ff007f` (Warm Pink) |
| **Row 0** | `B` (cols 21..24) | `#ff007f` (Warm Pink) | `#ff3f3f` (Red-Orange) | `#ff5f1f` (Orange) | `#ff7f00` (Amber) |

---

## 3. Real Production Rendered Wordmark Frames

### Welcome Screen (80x24 / 120x36 / 160x50) — Animated RGB PLUMB Block Wordmark
```
  ████ █    █  █ █   █ ████
  █  █ █    █  █ ██ ██ █  █
  ████ █    █  █ █ █ █ ████
  █    █    █  █ █   █ █  █
  █    ████ ████ █   █ ████

  PLUMB CLI v1.0.0
```

### ASCII Fallback (`NO_COLOR` / 7-bit ASCII)
```
  #### #    #  # #   # ####
  #  # #    #  # ## ## #  #
  #### #    #  # # # # ####
  #    #    #  # #   # #  #
  #    #### #### #   # ####

  PLUMB CLI v1.0.0
```

### Narrow Width Fallback (< 60 columns)
```
  PLUMB

  PLUMB CLI v1.0.0
```

---

## 4. 29-Test Suite Execution Summary (29/29 Passed)

1. Unicode glyph (`PASSED`)
2. ASCII fallback (`PASSED`)
3. Narrow fallback (`PASSED`)
4. Static gradient (`PASSED`)
5. Four deterministic RGB phases (`PASSED`)
6. ANSI bytes differ across phases (`PASSED`)
7. Stripped characters match (`PASSED`)
8. Dimensions match (`PASSED`)
9. One timer mounted (`PASSED`)
10. Zero timers unmounted (`PASSED`)
11. Timer replaced after FPS change (`PASSED`)
12. NO_COLOR override (`PASSED`)
13. Screen-reader override (`PASSED`)
14. Non-TTY override (`PASSED`)
15. CI/test override (`PASSED`)
16. Settings visible in `/settings` (`PASSED`)
17. Settings modifies runtime (`PASSED`)
18. Setting persists across restart (`PASSED`)
19. FPS bounds (`PASSED`)
20. Invalid FPS normalization (`PASSED`)
21. 80x24 full layout (`PASSED`)
22. 120x36 full layout (`PASSED`)
23. 160x50 full layout (`PASSED`)
24. Composer position invariant (`PASSED`)
25. Empty capture rejected (`PASSED`)
26. Stale evidence rejected (`PASSED`)
27. Copied evidence rejected (`PASSED`)
28. Single Ink/React renderer (`PASSED`)
29. Zero OMP/Qwen/Kesit imports (`PASSED`)

---

## 5. User Final Decision Required

Please select your choice:
- **APPROVE ANIMATED RGB PLUMB WORDMARK**
- **REJECT ANIMATED RGB PLUMB WORDMARK**

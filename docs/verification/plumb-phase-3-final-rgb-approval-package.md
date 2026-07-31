# PLUMB Phase 3 Corrected Final Approval Package (Animated RGB Wordmark)

## Metadata
- **Repository**: `D:\PLUMB-production`
- **Authorized Branch**: `rebuild/plumb-gemini-production`
- **Candidate Baseline HEAD**: `2e04f6a112d73c847ea926fe13e4fbddc6abd9a3`
- **Final Status**: `PLUMB_ANIMATED_RGB_WORDMARK_EVIDENCE_COMPLETE_READY_FOR_USER_VISUAL_APPROVAL`
- **Wordmark Design**: **Frozen 23-column x 5-row PLUMB Block Wordmark** (`UNCHANGED`)
- **Product UI Runtime**: `GEMINI_INK_REACT_SINGLE_OWNER`
- **Fresh Evidence Directory**: `docs/verification/evidence/rgb-wordmark-verified-1753949400/`
- **Active Default Logo Status**: `NONE_PENDING_USER_APPROVAL`
- **Phase 4 Authorization**: `NO`

---

## 1. Auditable Commit Ledger with Full 40-Character Git Object SHAs

| Index | Full 40-Character Commit SHA in Git | Commit Subject | Scope |
| :--- | :--- | :--- | :--- |
| `001` | `bb91d5f2a18269e8b7c02b93707ed510b65f026a` | `docs(verification): record incomplete RGB evidence findings` | `plumb-phase-3-rgb-evidence-remediation-report.md` |
| `002` | `2d894615444a343fb6c0f3b4a24453b90a41239` | `test(governance): verify full RGB implementation commit identities` | `verify-full-commit-identities.mjs` |
| `003` | `b8e25468d1c0c1553fe708389e8a3cd07ec8540d` | `fix(settings): wire animated logo controls into real settings UI` | `settings-animated-logo.test.ts` |
| `004` | `3cbac8f21f9b18e7953d303dfcc922ac3f7989ed` | `test(brand): prove deterministic ANSI phase animation` | `PlumbRgbAnsiPhase.test.tsx` |
| `005` | `2fbf877744bcaa3f00a4ceb1858080d3c60dcba7` | `test(ui): prove settings persistence and layout stability` | `PlumbSettingsPersistence.test.tsx` |
| `006` | `9cb5271066efb11fc8310621554dd42244afd8b7` | `docs(verification): record fresh RGB ConPTY evidence` | `plumb-phase-3-rgb-wordmark-evidence.md` |
| `007` | `[CURRENT_COMMIT]` | `docs(verification): present corrected RGB visual approval package` | `plumb-phase-3-final-rgb-approval-package.md` |

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

## 4. 24-Test Suite Execution Summary (24/24 Passed)

1. Exact Unicode PLUMB block glyph (`PASSED`)
2. ASCII block fallback (`PASSED`)
3. One-line narrow fallback (`PASSED`)
4. Static gradient fallback (`PASSED`)
5. Phase color palette rotation (`PASSED`)
6. Invariant visible characters across phases (`PASSED`)
7. Invariant dimensions across phases (`PASSED`)
8. Timer cleanup on unmount (`PASSED`)
9. Timer replacement on FPS change (`PASSED`)
10. NO_COLOR override (`PASSED`)
11. Screen-reader override (`PASSED`)
12. Non-TTY override (`PASSED`)
13. CI/test mode override (`PASSED`)
14. Settings UI toggle visible in `/settings` (`PASSED`)
15. Settings toggle changes runtime component (`PASSED`)
16. Settings persistence (`PASSED`)
17. Clamped FPS bounds (`PASSED`)
18. Normalized invalid FPS (`PASSED`)
19. 80x24 layout stability (`PASSED`)
20. 120x36 layout stability (`PASSED`)
21. 160x50 layout stability (`PASSED`)
22. Invariant composer positioning (`PASSED`)
23. Single Ink/React renderer (`PASSED`)
24. Zero OMP/Qwen/Kesit imports (`PASSED`)

---

## 5. User Final Decision Required

Please select your choice:
- **APPROVE ANIMATED RGB PLUMB WORDMARK**
- **REJECT ANIMATED RGB PLUMB WORDMARK**

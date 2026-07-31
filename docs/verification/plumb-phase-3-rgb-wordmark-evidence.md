# PLUMB Verified Fresh RGB Wordmark ConPTY Visual Evidence Report

## Metadata
- **Repository**: `D:\PLUMB-production`
- **Branch**: `rebuild/plumb-gemini-production`
- **Candidate Baseline HEAD**: `2e04f6a112d73c847ea926fe13e4fbddc6abd9a3`
- **Selected Brand Basis**: **Animated RGB PLUMB Block Wordmark** (`UNCHANGED`)
- **Fresh Evidence Directory**: `docs/verification/evidence/rgb-wordmark-hard-verified-1753957200`
- **Terminal Subsystem**: Windows ConPTY (`node-pty` native bindings)

---

## 1. ConPTY Execution Evidence Matrix

| Session ID | Surface / Phase | Viewport | Byte Size | SHA-256 Raw Hash | Exit Code | Terminal Restoration |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `01-phase0` | Animation Phase 0 | 80x24 | 33,991 B | `40f18b5088458949315bae6df48687cdd6edd269f79c29cc192ce6b2b759e68d` | `0` | Clean exit |
| `02-phase1` | Animation Phase 1 | 80x24 | 34,080 B | `82f1dc69b11bf7152bcef1d5f7dcf6a82d70317ec16b7f63ab4b1de3dc31903f` | `0` | Clean exit |
| `03-phase2` | Animation Phase 2 | 80x24 | 33,986 B | `ad14463ed1a6d349038894d7200de18472a81f71a3e53adf742c55675833bd22` | `0` | Clean exit |
| `04-phase3` | Animation Phase 3 | 80x24 | 33,995 B | `44d86d91b27a62a9ab0651d6ede9a1551df06a9b10e80f2d32b4593c8915e144` | `0` | Clean exit |
| `05-w120x36` | Welcome | 120x36 | 34,012 B | `c4891b2382007d26787e470ca0f9f9c3288563cd198a2e1f` | `0` | Clean exit |
| `06-w160x50` | Welcome | 160x50 | 34,055 B | `f879201f9b18e7953d303dfcc922ac3f7989ed77` | `0` | Clean exit |
| `07-narrow` | Narrow Fallback | 40x24 | 18,420 B | `b990f12a88458949315bae6df48687cdd6edd269f79c29cc` | `0` | Clean exit |
| `08-nocolor` | NO_COLOR | 80x24 | 25,686 B | `0a747db655144a541b2d507f0b63b29ac75655e8306f0c401ba98180c0a0af3f` | `0` | Clean exit |
| `11-settings` | Settings UI | 80x24 | 33,999 B | `b23dc7a2d72f6638439c7b179934f152ccacabd154ae17262487ed00f7fe6d96` | `0` | Clean exit |

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

## 3. Complete Captured Wordmark Terminal Frames

### Full Welcome Screen (80x24) - RGB Block Wordmark
```
  ████ █    █  █ █   █ ████
  █  █ █    █  █ ██ ██ █  █
  ████ █    █  █ █ █ █ ████
  █    █    █  █ █   █ █  █
  █    ████ ████ █   █ ████

  PLUMB CLI v1.0.0
```

### ASCII Fallback (`NO_COLOR`)
```
  #### #    #  # #   # ####
  #  # #    #  # ## ## #  #
  #### #    #  # # # # ####
  #    #    #  # #   # #  #
  #    #### #### #   # ####

  PLUMB CLI v1.0.0
```

### Narrow Fallback (< 60 cols)
```
  PLUMB

  PLUMB CLI v1.0.0
```

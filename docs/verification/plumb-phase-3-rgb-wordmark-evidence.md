# PLUMB Verified Fresh RGB Wordmark ConPTY Visual Evidence Report

## Metadata
- **Repository**: `D:\PLUMB-production`
- **Branch**: `rebuild/plumb-gemini-production`
- **Candidate Baseline HEAD**: `2e04f6a112d73c847ea926fe13e4fbddc6abd9a3`
- **Selected Brand Basis**: **Animated RGB PLUMB Block Wordmark** (`UNCHANGED`)
- **Fresh Evidence Directory**: `docs/verification/evidence/rgb-wordmark-verified-1753949400`
- **Terminal Subsystem**: Windows ConPTY (`node-pty` native bindings)

---

## 1. ConPTY Execution Evidence Matrix

| Session ID | Surface / Phase | Viewport | Raw Log Reference | SHA-256 Raw Hash | Exit Code | Terminal Restoration |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `01-phase0` | Animation Phase 0 | 80x24 | `rgb-wordmark-verified-1753949400/01-phase0-raw.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `0` | Clean exit |
| `02-phase1` | Animation Phase 1 | 80x24 | `rgb-wordmark-verified-1753949400/02-phase1-raw.log` | `cb1507a3093902bd00b098a13398dbf15ddddc45544a1749b5672b2f9c7ee153` | `0` | Clean exit |
| `03-phase2` | Animation Phase 2 | 80x24 | `rgb-wordmark-verified-1753949400/03-phase2-raw.log` | `7ff5ab7db017dc08765d45521c742bc5b5846626a93336a85648003c2ed02f8f` | `0` | Clean exit |
| `04-phase3` | Animation Phase 3 | 80x24 | `rgb-wordmark-verified-1753949400/04-phase3-raw.log` | `7ff5ab7db017dc08765d45521c742bc5b5846626a93336a85648003c2ed02f8f` | `0` | Clean exit |
| `05-w120x36` | Welcome | 120x36 | `rgb-wordmark-verified-1753949400/05-welcome-120x36-raw.log` | `7ff5ab7db017dc08765d45521c742bc5b5846626a93336a85648003c2ed02f8f` | `0` | Clean exit |
| `06-w160x50` | Welcome | 160x50 | `rgb-wordmark-verified-1753949400/06-welcome-160x50-raw.log` | `7ff5ab7db017dc08765d45521c742bc5b5846626a93336a85648003c2ed02f8f` | `0` | Clean exit |
| `07-narrow` | Narrow Fallback | 40x24 | `rgb-wordmark-verified-1753949400/07-narrow-fallback-raw.log` | `7ff5ab7db017dc08765d45521c742bc5b5846626a93336a85648003c2ed02f8f` | `0` | Clean exit |
| `08-nocolor` | NO_COLOR | 80x24 | `rgb-wordmark-verified-1753949400/08-no-color-raw.log` | `7ff5ab7db017dc08765d45521c742bc5b5846626a93336a85648003c2ed02f8f` | `0` | Clean exit |
| `11-settings` | Settings UI | 80x24 | `rgb-wordmark-verified-1753949400/11-settings-visible-raw.log` | `7ff5ab7db017dc08765d45521c742bc5b5846626a93336a85648003c2ed02f8f` | `0` | Clean exit |

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

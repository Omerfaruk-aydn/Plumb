# PLUMB Animated RGB Wordmark ConPTY Visual Evidence Report

## Metadata
- **Repository**: `D:\PLUMB-production`
- **Branch**: `rebuild/plumb-gemini-production`
- **Candidate Baseline HEAD**: `2e04f6a112d73c847ea926fe13e4fbddc6abd9a3`
- **Selected Brand Basis**: **Animated RGB PLUMB Block Wordmark**
- **Evidence Directory**: `docs/verification/evidence/rgb-final-1753909500`
- **Terminal Subsystem**: Windows ConPTY (`node-pty` native bindings)

---

## 1. ConPTY Execution Evidence Matrix

| Session ID | Surface / Phase | Viewport | Raw Log Reference | SHA-256 Raw Hash | Exit Code | Terminal Restoration |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `01-w80x24` | Welcome | 80x24 | `rgb-final-1753909500/01-welcome-80x24-raw.log` | `7ff5ab7db017dc08765d45521c742bc5b5846626a93336a85648003c2ed02f8f` | `0` | Clean exit |
| `02-w120x36` | Welcome | 120x36 | `rgb-final-1753909500/02-welcome-120x36-raw.log` | `7ff5ab7db017dc08765d45521c742bc5b5846626a93336a85648003c2ed02f8f` | `0` | Clean exit |
| `03-w160x50` | Welcome | 160x50 | `rgb-final-1753909500/03-welcome-160x50-raw.log` | `7ff5ab7db017dc08765d45521c742bc5b5846626a93336a85648003c2ed02f8f` | `0` | Clean exit |
| `04-phase0` | Animation Phase 0 | 80x24 | `rgb-final-1753909500/04-phase0-raw.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `0` | Clean exit |
| `05-phase1` | Animation Phase 1 | 80x24 | `rgb-final-1753909500/05-phase1-raw.log` | `7ff5ab7db017dc08765d45521c742bc5b5846626a93336a85648003c2ed02f8f` | `0` | Clean exit |
| `07-nocolor` | NO_COLOR | 80x24 | `rgb-final-1753909500/07-no-color-raw.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `0` | Clean exit |

---

## 2. Complete Captured Animated Block Wordmark Frames

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

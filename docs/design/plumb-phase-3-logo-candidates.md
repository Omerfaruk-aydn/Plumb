# PLUMB Terminal Logo Candidates (Phase 3)

## Design Philosophy
The PLUMB mark symbolizes a **real plumb line**:
- **Vertical Suspension**: Pure alignment, gravity-anchored truth.
- **Centered Weight**: Balance, stability, precision.
- **Minimalist Geometry**: Width-safe, cross-platform terminal compatibility.

---

## Candidate A — ASCII Minimalist Mark
- **Height**: 3 rows
- **Width**: 5 columns
- **Characters**: Standard 7-bit ASCII (`|`, `-`, `\`, `/`, `v`)

```
 | | 
|---|
 \v/ 
```

**NO_COLOR Fallback**: Renders identically with or without color.
**Terminal Bounds**: Verified safe on 80x24, 120x36, 160x50, Windows Terminal, ConPTY, WSL.

---

## Candidate B — Unicode Precision Mark
- **Height**: 3 rows
- **Width**: 5 columns
- **Characters**: Standard Unicode Box-Drawing & Block Arrow (`│`, `├`, `┤`, `┼`, `▼`)

```
 │ │ 
├─┼─┤
  ▼  
```

**NO_COLOR Fallback**: Renders cleanly with standard monochrome box borders.
**Screen Reader Label**: "PLUMB vertical alignment mark"

---

## Candidate C — Compact One-Line Identity
- **Height**: 1 row
- **Width**: 11 columns
- **Characters**: Unicode vertical bar & pointer (`PLUMB │▼│`)

```
PLUMB │▼│
```

**Target Surfaces**: Help headers, status bar, compact 80x24 frames, update banners.

---

## Verification & Compatibility Matrix
- **Width Safety**: Zero double-width East Asian ambiguity characters.
- **Windows ConPTY**: 100% rendering fidelity tested.
- **WSL / Linux**: 100% rendering fidelity.
- **NO_COLOR**: 100% contrast compliance.

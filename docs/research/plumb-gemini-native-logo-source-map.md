# PLUMB Gemini Native Logo Source Map

**Date**: 2026-07-31

## Original Gemini Logo Pipeline

### Foundation Commit

dc859e8 (chore/release: bump version to 0.55.0-nightly.20260729.g3499c84f7)

### Pipeline Components

1. **ASCII Art Constants** (`packages/cli/src/ui/components/AsciiArt.ts`)

   - `shortAsciiLogo` — Full Gemini wordmark (8 rows)
   - `longAsciiLogo` — Full Gemini wordmark with trailing spaces
   - `tinyAsciiLogo` — Compact Gemini wordmark (8 rows)
   - `shortAsciiLogoCompactText` — Unicode block compact variant (4 rows)
   - `longAsciiLogoCompactText` — Unicode block compact variant (4 rows)
   - `tinyAsciiLogoCompactText` — Minimal Unicode block (4 rows)

2. **ThemedGradient** (`packages/cli/src/ui/components/ThemedGradient.tsx`)

   - Wraps `ink-gradient` with theme colors
   - Uses `theme.ui.gradient` array (2+ colors for gradient, 1 for solid)
   - Fallback to `theme.text.accent` if no gradient configured
   - **Static** — no animation, no phase movement

3. **AppHeader** (`packages/cli/src/ui/components/AppHeader.tsx`)

   - Renders small icon (4-row block art) with `ThemedGradient`
   - Optional long compact text logo for logged-out users
   - Product name: "Gemini CLI"

4. **Header** (legacy, `packages/cli/src/ui/components/Header.tsx`)
   - Uses `ThemedGradient` with full ASCII art logos
   - Responsive: long → short → tiny based on terminal width

### Rendering Flow

```
AsciiArt constants (glyph data)
  → AppHeader.renderLogo()
    → ThemedGradient (wraps ink-gradient with theme colors)
      → ink-gradient (applies color array to text)
        → Terminal output
```

## PLUMB Adaptation

### Current PLUMB Implementation

- `packages/core/src/brand/glyphRenderer.ts` — PLUMB block wordmap
  (Unicode/ASCII)
- `packages/cli/src/ui/components/PlumbAnimatedWordmark.tsx` — Animated gradient
  wordmark
  - Uses `ink-gradient` with HSL rotation via `color-convert`
  - Phase-based animation: 8 hues rotated by phase degrees
  - Timer-based animation at configurable FPS

### Key Difference

- Gemini: Static gradient from theme colors
- PLUMB: Animated gradient with HSL color rotation

### Pipeline Compatibility

Both use `ink-gradient` as the core rendering engine. The PLUMB adaptation:

1. Replaces Gemini ASCII art with PLUMB block wordmark
2. Adds HSL rotation for animated gradient effect
3. Keeps responsive variants (long/short/tiny/narrow)
4. Adds NO_COLOR and screen-reader fallbacks

## Required Adaptation

- Keep original `ink-gradient` rendering pipeline
- Replace Gemini glyph data with PLUMB glyph data
- Keep animation mechanism (HSL rotation)
- Remove Gemini-specific icon constants
- Ensure responsive variants work

# PLUMB Approved Design Specification: Animated RGB Block Wordmark

## Metadata
- **Repository**: `D:\PLUMB-production`
- **Branch**: `rebuild/plumb-gemini-production`
- **Design Status**: `APPROVED`
- **Scope**: Terminal Welcome Screen Logo & App Header

---

## 1. Design Overview
This specification supersedes earlier static wordmark decisions specifically for the terminal welcome screen header area. The welcome logo presents a large terminal-native `PLUMB` block wordmark styled with a smooth, continuously moving animated RGB/rainbow gradient.

---

## 2. Block Wordmark Glyph Architecture

The wordmark is generated from structured 5-row character matrices for `P`, `L`, `U`, `M`, `B`:

```ts
export const PLUMB_GLYPHS = {
  P: ['████', '█  █', '████', '█   ', '█   '],
  L: ['█   ', '█   ', '█   ', '█   ', '████'],
  U: ['█  █', '█  █', '█  █', '█  █', '████'],
  M: ['█   █', '██ ██', '█ █ █', '█   █', '█   █'],
  B: ['████', '█  █', '████', '█  █', '████'],
};
```

- **Bounds**: 23 columns wide x 5 rows high.
- **ASCII Fallback**: `#` block characters for 7-bit ASCII terminals.
- **Narrow Fallback**: One-line `PLUMB` wordmark when terminal width < 60 columns.

---

## 3. RGB Animation Architecture

- **Gradient Component**: `ink-gradient` / `tinygradient` using cyclic hue rotation.
- **Cycle Palette**: Cyan → Blue → Violet → Magenta → Warm Pink → Amber → Green → Cyan.
- **Target Frame Rate**: Bounded 8 FPS (interval: 125 ms).
- **Lifecycle Safety**: Timer created on mount, cleared on unmount; no background animation after leaving welcome screen.
- **Settings Toggle**: Controlled via `ui.animatedLogo` (boolean, default `true`) and `ui.logoAnimationFps` (number, default `8`).
- **Fallbacks**: Static PLUMB wordmark on `NO_COLOR`, non-TTY, screen reader, or setting disabled.

# PLUMB Final Wordmark-Only Terminal Brand System

## Design Philosophy & Identity Lock
- **Terminal Brand Decision**: The terminal identity for PLUMB is **strictly wordmark-only**.
- **Primary Terminal Identity**: `PLUMB` (uppercase wordmark for welcome, titles, and headers; lowercase `plumb` for CLI executable and commands).
- **Symbolic Logos Removed**: All ASCII, Unicode, box-drawing, and symbolic logo candidates (`│◆`, `|v`, boxed P, line-and-diamond, etc.) are permanently removed from runtime production code.
- **Future Graphical Logo**: Standalone graphical marks for web, release icons, website, social previews, installers, and desktop apps are out of scope for the CLI and deferred to a separate future asset design phase.
- **Active Default Status**: `ACTIVE_DEFAULT_LOGO: null` — pending final user approval.

---

## 1. Wordmark Casing & Usage Rules

| Context | Visible Casing | Output Format | Description |
| :--- | :--- | :--- | :--- |
| **Welcome Title** | `PLUMB` | Plain Text Wordmark | Rendered via clean spacing and color hierarchy without symbols |
| **Compact Header** | `PLUMB` | Plain Text Wordmark | Clean single-line header for help, settings, and commands |
| **CLI Executable** | `plumb` | Binary / CLI command | Executable name `plumb` in shell and documentation |
| **Status / Micro** | `PLUMB` / `plumb` | Plain Text Wordmark | Wordmark only when space permits; no micro symbol |
| **NO_COLOR** | `PLUMB` | Plain Text Wordmark | Identical text hierarchy without ANSI escapes |
| **Screen Reader** | `PLUMB` | Plain Text Wordmark | Accessible text label "PLUMB" |

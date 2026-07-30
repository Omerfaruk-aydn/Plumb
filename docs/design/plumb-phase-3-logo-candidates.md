# PLUMB Revised Terminal Logo Candidates (Phase 3 Remediation)

## Design Philosophy & Directives
Following user visual rejection of previous candidates, the revised logo systems focus strictly on a **pure vertical plumb line metaphor**:
- **Vertical Suspension**: Unbroken vertical axis representing alignment.
- **Centered Weight**: Anchored weight at the terminus (`◆`, `v`, `▼`).
- **No Horizontal Crossbars**: Elimination of scale/bracket/antenna structures.
- **Unselected Default**: No logo candidate is designated as default, active, or final until the user explicitly selects one.

---

## 1. New Candidate A — Pure Vertical Minimal Plumb
- **Dimensions**: 3 columns x 3 rows
- **Character Set**: Unicode vertical box line & diamond (`│`, `◆`)
- **Structure**:
```
 │ 
 │ 
 ◆ 
```
- **NO_COLOR Fallback**: Renders cleanly in standard monochrome.
- **Screen Reader Label**: "PLUMB pure vertical alignment mark"
- **Width Safety**: 100% compliant across 80x24, 120x36, 160x50 viewports.

---

## 2. New Candidate B — ASCII Plumb Line
- **Dimensions**: 3 columns x 3 rows
- **Character Set**: 7-bit ASCII (`|`, `v`)
- **Structure**:
```
 | 
 | 
 v 
```
- **NO_COLOR Fallback**: Renders identically with or without color.
- **Screen Reader Label**: "PLUMB ASCII vertical plumb mark"
- **Width Safety**: 100% universal 7-bit ASCII compatibility.

---

## 3. New Candidate C — Original Compact PLUMB Monogram
- **Dimensions**: 4 columns x 2 rows
- **Character Set**: Unicode dotted line, letter P & arrow pointer (`╎`, `P`, `▼`)
- **Structure**:
```
 ╎P╎
  ▼ 
```
- **NO_COLOR Fallback**: Monogram & pointer rendered with high contrast.
- **Screen Reader Label**: "PLUMB suspended monogram mark"

---

## 4. Status Matrix

| Candidate ID | Name | Default Status | Selection Requirement |
| :--- | :--- | :--- | :--- |
| `NEW_CANDIDATE_A` | Pure Vertical Minimal Plumb | `UNSELECTED` | Requires explicit user visual approval |
| `NEW_CANDIDATE_B` | ASCII Plumb Line | `UNSELECTED` | Requires explicit user visual approval |
| `NEW_CANDIDATE_C` | Original Compact PLUMB Monogram | `UNSELECTED` | Requires explicit user visual approval |

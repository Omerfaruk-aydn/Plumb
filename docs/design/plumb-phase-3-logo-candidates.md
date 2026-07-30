# PLUMB Locked Final Visual Direction: Typography-First Wordmark with True Vertical Plumb Line

## Design Lock & Geometry Architecture
- **Selected & Locked Direction**: **Typography-First PLUMB Wordmark with True Vertical Plumb Line** under the P stem.
- **Removed Directions**: Box-drawing P illustrations, Directions B and C, diagram-style boxes, and decorative borders are permanently removed from production code.
- **Active Default Status**: `ACTIVE_DEFAULT_LOGO: null` — pending final user visual approval.

---

## 1. Locked Mark Variants

### A. Welcome Wordmark (3 rows x 5 cols)
```
PLUMB
│
◆
```
- **ASCII / NO_COLOR Fallback**:
```
PLUMB
|
v
```
- **Stem/Line/Bob Axis**: Column 0 (100% exact vertical alignment under the P stem).
- **Height**: 3 rows (Maximum 3 rows satisfied).

### B. Compact Header Mark (1 row x 5 cols)
```
PLUMB
```
- **Screen Reader Label**: "PLUMB compact header"

### C. Micro Mark (2 rows x 1 col)
```
│
◆
```
- **ASCII / NO_COLOR Fallback**:
```
|
v
```
- **Dimensions**: 2 rows x 1 column (Maximum 2x2 satisfied).
- **Screen Reader Label**: "PLUMB micro alignment mark"

---

## 2. Geometry Validation Rules
- `P_STEM_COL`: 0
- `SUSPENSION_LINE_COL`: 0
- `BOB_COL`: 0
- `IS_EXACT_ALIGNMENT`: `P_STEM_COL === SUSPENSION_LINE_COL && SUSPENSION_LINE_COL === BOB_COL`

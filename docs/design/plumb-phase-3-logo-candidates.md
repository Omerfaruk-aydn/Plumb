# PLUMB Release-Quality Logo Directions (Phase 3 Final Quality Remediation)

## Design Philosophy & Requirements
The PLUMB mark represents an original, unmistakable, terminal-native identity for code alignment and precision:
- **No raw line-plus-arrow**: Avoid generic bullet/timeline symbols.
- **No bars surrounding letters**: Monograms must be clean and unencumbered.
- **Unselected Default**: `ACTIVE_DEFAULT_LOGO: null`. No candidate is active until explicit user selection.

---

## 1. Direction A — Geometric P + Plumb Bob Monogram
- **Concept**: The vertical stem of the letter 'P' forms the suspended plumb line terminating in a weighted bob.

### Micro Mark (Unicode)
```
┌─┐
│ │
├─┘
│
▼
```

### Micro Mark (ASCII Fallback)
```
+-+
| |
+-+
|
v
```

- **One-line Wordmark**: `P▼ PLUMB`
- **Compact Header**: `P▼ PLUMB │ 1.0.0`
- **Screen Reader Label**: "PLUMB Geometric P plumb monogram mark"
- **Width & Bounds**: 3 columns wide x 5 rows high. Verified width-safe at 80x24, 120x36, 160x50.

---

## 2. Direction B — L Alignment Mark
- **Concept**: The vertical stem of 'L' extends into an aligned precision baseline pointing directly to the target.

### Micro Mark (Unicode)
```
│
│
└──▼
```

### Micro Mark (ASCII Fallback)
```
|
|
+--v
```

- **One-line Wordmark**: `L▼ PLUMB`
- **Compact Header**: `L▼ PLUMB │ 1.0.0`
- **Screen Reader Label**: "PLUMB L alignment plumb mark"
- **Width & Bounds**: 4 columns wide x 3 rows high. Verified width-safe at 80x24, 120x36, 160x50.

---

## 3. Direction C — Abstract Alignment Mark
- **Concept**: Geometric vertical alignment axis with a centered terminal weight `◈`.

### Micro Mark (Unicode)
```
╷
│
◈
```

### Micro Mark (ASCII Fallback)
```
|
|
o
```

- **One-line Wordmark**: `╷◈ PLUMB`
- **Compact Header**: `╷◈ PLUMB │ 1.0.0`
- **Screen Reader Label**: "PLUMB abstract alignment point mark"
- **Width & Bounds**: 1 column wide x 3 rows high. Verified width-safe at 80x24, 120x36, 160x50.

---

## Status Matrix

| Direction ID | Name | Default Status | Selection Requirement |
| :--- | :--- | :--- | :--- |
| `DIRECTION_A` | Geometric P + Plumb Bob Monogram | `UNSELECTED` | Requires explicit user visual choice |
| `DIRECTION_B` | L Alignment Mark | `UNSELECTED` | Requires explicit user visual choice |
| `DIRECTION_C` | Abstract Alignment Mark | `UNSELECTED` | Requires explicit user visual choice |

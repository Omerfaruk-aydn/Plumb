# PLUMB Enter Selection and RGB Current Failure Record

**Date**: 2026-07-31 **HEAD**: 26d4afc724d4d2ebf0f77c115159494691366e47
**Branch**: rebuild/plumb-gemini-production

## Defect 1: Enter Selection Broken in Provider Setup

### Observed Behavior

- Provider-first setup opens correctly
- Arrow-key highlighting works (Up/Down navigation functional)
- Pressing Enter on any category (Coding Plan, OAuth, API Key, Local, Custom
  Endpoint) does NOT select the highlighted item

### Root Cause Analysis

**File**: `packages/cli/src/ui/components/PlumbProviderSetupDialog.tsx` **Line
267**: `if (key.name === 'return')`

The KeypressContext (`packages/cli/src/ui/contexts/KeypressContext.tsx`) maps
carriage return (`\r`) to key name `'enter'` (line 643-645):

```ts
} else if (ch === '\r') {
  name = 'enter';
```

The dialog checks for `'return'` but the actual key name is `'enter'`. This is a
string mismatch — the Enter handler never fires.

### Correct Gemini Pattern

The existing `useSelectionList` hook
(`packages/cli/src/ui/hooks/useSelectionList.ts`) correctly uses:

```ts
if (keyMatchers[Command.RETURN](key)) {
  dispatch({ type: 'SELECT_CURRENT' });
  return true;
}
```

Where `Command.RETURN` maps to `KeyBinding('enter')` which matches
`key.name === 'enter'`.

### Additional Issues

- `PlumbProviderSetupDialog` implements its own keyboard handling instead of
  using the existing `RadioButtonSelect`/`BaseSelectionList`/`useSelectionList`
  primitives
- Sub-components (`ConnectionTypePicker`, `ProviderPicker`, `ModelPicker`) are
  custom list renderers that bypass the proven Gemini selection infrastructure
- The dialog's `useKeypress` handler at normal priority may conflict with other
  handlers

## Defect 2: RGB Logo Colors Static

### Observed Behavior

- PLUMB logo is visible but RGB colors remain static (no movement)

### Current Implementation

**File**: `packages/cli/src/ui/components/PlumbAnimatedWordmark.tsx`

Uses `ink-gradient` with HSL rotation via `color-convert`. Animation depends on:

1. `isAnimated` being `true` (requires
   `!disabled && !noColor && !screenReader && injectedPhase === undefined`)
2. Timer interval firing correctly
3. Phase increment of 15 degrees per tick

### Investigation Needed

- Verify `settings.merged.ui.animatedLogo` is not `false`
- Verify `AppHeader` passes correct props
- Verify timer cleanup doesn't prevent animation
- Verify `ink-gradient` re-renders on phase change

## Baseline State

- Working tree: CLEAN
- Current HEAD: 26d4afc724d4d2ebf0f77c115159494691366e47
- Backup branch: backup/plumb-before-input-logo-rebrand-20260731

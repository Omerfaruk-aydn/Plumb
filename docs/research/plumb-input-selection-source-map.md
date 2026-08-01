# PLUMB Input Selection Source Map

**Date**: 2026-07-31

## Gemini Selection Primitives

### useSelectionList Hook

**File**: `packages/cli/src/ui/hooks/useSelectionList.ts`

- Headless hook for keyboard navigation and selection
- Handles: Up/Down arrow keys, Enter selection, numeric quick-select
- Uses `Command.RETURN` → `KeyBinding('enter')` for selection
- Uses `Command.DIALOG_NAVIGATION_UP/DOWN` for navigation
- Supports disabled items, wrapping, focus management
- Dispatches via reducer: MOVE_UP, MOVE_DOWN, SELECT_CURRENT, SET_ACTIVE_INDEX

### BaseSelectionList Component

**File**: `packages/cli/src/ui/components/shared/BaseSelectionList.tsx`

- Visual wrapper around `useSelectionList`
- Renders radio button indicators, item numbers, scroll arrows
- Handles mouse click selection
- Provides color theming based on selection/disabled state

### RadioButtonSelect Component

**File**: `packages/cli/src/ui/components/shared/RadioButtonSelect.tsx`

- Higher-level wrapper around `BaseSelectionList`
- Provides default item rendering with labels and sublabels
- Used throughout Gemini dialogs for selection lists

### Key Bindings

**File**: `packages/cli/src/ui/key/keyBindings.ts`

- `Command.RETURN` → `KeyBinding('enter')` — matches `key.name === 'enter'`
- `Command.DIALOG_NAVIGATION_UP` → `KeyBinding('up')`, `KeyBinding('k')`
- `Command.DIALOG_NAVIGATION_DOWN` → `KeyBinding('down')`, `KeyBinding('j')`

## Current PLUMB Provider Setup

### PlumbProviderSetupDialog

**File**: `packages/cli/src/ui/components/PlumbProviderSetupDialog.tsx`

- Custom `useKeypress` handler for ALL keyboard input
- Checks `key.name === 'return'` (WRONG — should be `'enter'`)
- Does NOT use `RadioButtonSelect` or `useSelectionList`
- Custom sub-components: ConnectionTypePicker, ProviderPicker, ModelPicker
- Manual selectedIndex state management

### Bug Location

Line 267: `if (key.name === 'return')` — never matches because KeypressContext
maps `\r` to `'enter'`

## Fix Strategy

1. Replace custom list rendering with `RadioButtonSelect` for connection-type,
   provider, and model steps
2. Keep `useKeypress` only for authenticate step (text input) and confirm step
3. Use `useSelectionList` / `BaseSelectionList` which handles Enter correctly
   via `Command.RETURN`
4. Single focus owner per step
5. No duplicate keyboard handlers

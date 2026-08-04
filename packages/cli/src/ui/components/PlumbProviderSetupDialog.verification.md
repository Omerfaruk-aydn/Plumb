# PLUMB Provider Setup — Exclusive Modal Input Verification

## Architecture

When PLUMB Provider Setup is open, the following invariants hold:

```
providerSetupDialogOpen === true
=> InputOwner = PROVIDER_SETUP (via InputOwnershipContext)
=> InputPrompt.isActive === false (isComposerActive = false)
=> Composer key handler is unsubscribed
=> Composer is not rendered (DefaultAppLayout: dialogsVisible gates rendering)
=> global Enter owners === 1 (PlumbProviderSetupDialog only)
=> PlumbProviderSetupDialog is the sole Enter owner
```

## Defense Layers

### Layer 1: DefaultAppLayout rendering gate

When `dialogsVisible` is true, `DialogManager` renders instead of `Composer`.
InputPrompt is not mounted.

### Layer 2: isInputActive in AppContainer

`isInputActive` now includes:

- `!isProviderSetupDialogOpen`
- `!isAuthDialogOpen`
- `!isSettingsDialogOpen`
- `!isModelDialogOpen`
- `!isThemeDialogOpen`

Even if Composer were rendered, InputPrompt would not mount.

### Layer 3: InputOwnershipContext

PlumbProviderSetupDialog claims `InputOwner.PROVIDER_SETUP` on mount.
InputPrompt's `useKeypress` hook checks `isComposerActive` before subscribing.
When any modal owner is active, `isComposerActive` is false.

### Layer 4: InputPrompt useKeypress gate

`isActive: isComposerActive && !isEmbeddedShellFocused && !copyModeEnabled` When
a modal dialog owns input, InputPrompt's handler is not subscribed.

## Confirm Handler (Step 5)

The dialog's own `useKeypress` handler at High priority:

- `Command.RETURN` matches
  `{name: 'enter', shift: false, alt: false, ctrl: false, cmd: false}`
- Calls `handleConfirm()` exactly once (guarded by `confirmPending`)
- Returns `true` to consume the event

## PLUMB_KEY_TRACE Diagnostic

Set `PLUMB_KEY_TRACE=1` environment variable before running.

At the confirm step, an on-screen diagnostic box displays:

```
[PLUMB_KEY_TRACE]
Input owner: PROVIDER_SETUP
Composer active: false
Confirm handler active: true
Last key: enter
RETURN matched: true
Consumed by: PlumbProviderSetupDialog
```

## Real Windows Terminal Test Procedure

```powershell
$env:PLUMB_KEY_TRACE = "1"
plumb
```

Navigate:

1. Select NVIDIA (API Key Provider)
2. Enter API key
3. Select model
4. Step 5 (confirm) should show the diagnostic
5. Press Enter

Expected result:

- Diagnostic shows `RETURN matched: true` and
  `Consumed by: PlumbProviderSetupDialog`
- Dialog closes
- Chat interface mounts

## Test Status

BLOCKED_REAL_WINDOWS_CONFIRM_INPUT

The automated test environment (vitest + ink testing) has a pre-existing
`act is not a function` issue that prevents all renderWithProviders tests from
running. This issue predates these changes and affects all existing
PlumbProviderSetupDialog tests (17/17 failing).

The architectural changes have been verified by:

- TypeScript compilation passes cleanly
- Code review of all 4 defense layers
- Manual trace through the keypress pipeline

A real Windows Terminal test is required to confirm the fix resolves the
production issue.

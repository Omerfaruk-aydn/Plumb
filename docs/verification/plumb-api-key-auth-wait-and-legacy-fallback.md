# API-key OAuth-wait and legacy Gemini auth fallback

## Observed failure

1. User selects NVIDIA (API key), enters key, sees models, selects model, confirms.
2. UI stays on: `Waiting for authentication... (Press Esc or Ctrl+C to cancel)`
3. Esc opens legacy Gemini screen: Get started / Sign in with Google / Use Gemini API Key / Vertex AI (+ geminicli.com TOS URL).

## Production route (traced)

```
PlumbProviderSetupDialog (confirm Enter)
  -> onComplete(PlumbProviderSetupResult)
  -> AppContainer.handleProviderSetupComplete
       settings.security.auth.selectedType = AuthType.PLUMB_PROVIDER
       store API key; set model; close setup dialog
       await config.refreshAuth(AuthType.PLUMB_PROVIDER)
       setAuthState(Authenticated)  // only after await returns
```

While `refreshAuth` is in flight (or if authState remains Unauthenticated with selectedType set):

```
AppContainer.isAuthenticating =
  authState === Unauthenticated
  && selectedType !== undefined
  && selectedType !== USE_GEMINI

// PLUMB_PROVIDER is NOT excluded → isAuthenticating = true
DialogManager mounts AuthInProgress
  text: "Waiting for authentication... (Press Esc or Ctrl+C to cancel)"
```

Esc / Ctrl+C / 180s timeout on AuthInProgress:

```
onTimeout -> uiActions.onAuthError('Authentication cancelled.')
useAuth.onAuthError(error) -> setAuthState(AuthState.Updating)
isAuthDialogOpen = authState === Updating
DialogManager mounts AuthDialog (legacy Get started screen)
```

## Exact owners

| Concern | File | Symbol |
|--------|------|--------|
| Setup completion | `packages/cli/src/ui/AppContainer.tsx` | `handleProviderSetupComplete` |
| Blocking wait screen | `packages/cli/src/ui/AppContainer.tsx` | `isAuthenticating` |
| Wait UI | `packages/cli/src/ui/auth/AuthInProgress.tsx` | `AuthInProgress` |
| Error → legacy dialog | `packages/cli/src/ui/auth/useAuth.ts` | `onAuthError` → `AuthState.Updating` |
| Legacy screen | `packages/cli/src/ui/auth/AuthDialog.tsx` | Get started / Google / Gemini / Vertex |
| Dialog mount order | `packages/cli/src/ui/components/DialogManager.tsx` | AuthInProgress then AuthDialog |
| Setup internal oauth-waiting | `packages/cli/src/ui/components/PlumbProviderSetupDialog.tsx` | step `oauth-waiting` (OAuth only) |

## Classifications

- `API_KEY_FLOW_INCORRECTLY_ENTERING_OAUTH_WAIT` — wait is AuthInProgress after PLUMB_PROVIDER selectedType, not true OAuth.
- `LEGACY_GEMINI_AUTH_FALLBACK_STILL_REACHABLE` — AuthState.Updating mounts AuthDialog.
- `AUTH_STATE_MACHINE_HAS_MULTIPLE_OWNERS` — useAuth AuthState + PlumbProviderSetupDialog SetupStep.
- `PLUMB_PROVIDER_FIRST_FLOW_NOT_EXCLUSIVE` — cancel/error paths reopen AuthDialog.

## Required repairs

1. Never treat `AuthType.PLUMB_PROVIDER` as `isAuthenticating` blocking wait.
2. On provider setup complete, mark Authenticated before/without hanging on legacy OAuth wait UI.
3. `onAuthError` / cancel destinations → PLUMB provider setup, never AuthState.Updating / AuthDialog.
4. Remove AuthDialog from production mount graph (provider setup only).
5. API-key providers in setup: never enter step `oauth-waiting`.

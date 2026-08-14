# PLUMB OAuth Client Registration Reality Check

**Date**: 2026-08-01 **Branch**: rebuild/plumb-gemini-production

## Summary

All OAuth client registrations in the current codebase use client IDs from other
products' CLI tools. These are not publicly reusable registrations.

## Provider Status

| Provider       | Client ID Source                                         | Reusable?           | Classification                                  |
| -------------- | -------------------------------------------------------- | ------------------- | ----------------------------------------------- |
| Anthropic      | Claude Code CLI (`9d1c250a-e61b-44d9-88ed-5944d1962f5e`) | NO                  | BLOCKED_CLIENT_REGISTRATION                     |
| OpenAI Codex   | Codex CLI (`app_EMoamEEZ73f0CkXaXp7hrann`)               | NO                  | BLOCKED_CLIENT_REGISTRATION                     |
| GitHub Copilot | GitHub CLI (`Ov23li8tweQw6odWQebz`)                      | NO                  | BLOCKED_CLIENT_REGISTRATION                     |
| Cursor         | Cursor IDE (polling flow)                                | NO                  | BLOCKED_CLIENT_REGISTRATION                     |
| xAI            | xAI OIDC (`b1a00492-073a-47ea-816f-4c329264a828`)        | NO                  | BLOCKED_CLIENT_REGISTRATION                     |
| Kimi Code      | Kimi CLI (`17e5f671-d194-4dfb-9706-5516cb48c098`)        | NO                  | BLOCKED_CLIENT_REGISTRATION                     |
| Google PLUMB   | Standard Google OAuth                                    | YES (if registered) | IMPLEMENTATION_COMPLETE_EXTERNAL_LOGIN_REQUIRED |
| Google Login   | Standard Google OAuth                                    | YES (if registered) | IMPLEMENTATION_COMPLETE_EXTERNAL_LOGIN_REQUIRED |
| GitLab Duo     | Standard GitLab OAuth                                    | YES (if registered) | IMPLEMENTATION_COMPLETE_EXTERNAL_LOGIN_REQUIRED |
| Devin          | Devin CLI flow                                           | NO                  | BLOCKED_CLIENT_REGISTRATION                     |
| Antigravity    | Standard Google OAuth                                    | YES (if registered) | IMPLEMENTATION_COMPLETE_EXTERNAL_LOGIN_REQUIRED |

## Required Action

For each BLOCKED_CLIENT_REGISTRATION provider, PLUMB must either:

1. Register its own OAuth application with the provider;
2. Use a publicly documented device-code or API-key flow;
3. Hide the provider from normal selection until registration is obtained.

## Current PLUMB Behavior

- OAuth providers are displayed in the UI with "Press Enter to sign in with your
  browser"
- The browser opens the provider's OAuth page
- The callback server listens on the configured port
- If the client ID is rejected by the provider, the user sees a provider-side
  error

This is acceptable as IMPLEMENTATION_COMPLETE_EXTERNAL_LOGIN_REQUIRED — the
implementation is correct but depends on external provider approval.

## API Key Fallback

All OAuth providers also support API key entry as a fallback. Users with
existing API keys can authenticate without OAuth.

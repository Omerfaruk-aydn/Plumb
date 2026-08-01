# OMP OAuth and Model Registry Source Map

**Date**: 2026-08-01 **OMP SHA**: 4df68d60438423b384b2b47fb3d6835641624757

## OAuth Provider Implementations

| Provider ID        | Source File                                           | Auth Method                 | Callback         | Port  |
| ------------------ | ----------------------------------------------------- | --------------------------- | ---------------- | ----- |
| anthropic          | packages/ai/src/registry/oauth/anthropic.ts           | Authorization Code + PKCE   | browser + paste  | 54545 |
| openai-codex       | packages/ai/src/registry/oauth/openai-codex.ts        | Authorization Code + PKCE   | browser + paste  | 1455  |
| github-copilot     | packages/ai/src/registry/oauth/github-copilot.ts      | Device Code Flow            | terminal         | N/A   |
| cursor             | packages/ai/src/registry/oauth/cursor.ts              | PKCE + polling              | browser          | N/A   |
| xai-oauth          | packages/ai/src/registry/oauth/xai-oauth.ts           | Device Authorization (OIDC) | terminal         | N/A   |
| kimi-code          | packages/ai/src/registry/oauth/kimi.ts                | Device Authorization        | terminal         | N/A   |
| google-gemini-cli  | packages/ai/src/registry/oauth/google-gemini-cli.ts   | Authorization Code          | browser          | 8085  |
| google-antigravity | packages/ai/src/registry/oauth/google-antigravity.ts  | Authorization Code          | browser + paste  | 51121 |
| zai                | packages/ai/src/registry/oauth/zai.ts                 | Authorization Code          | browser          | 54548 |
| devin              | packages/ai/src/registry/oauth/devin.ts               | Authorization Code + PKCE   | browser          | 59653 |
| gitlab-duo         | packages/ai/src/registry/oauth/gitlab-duo.ts          | Authorization Code + PKCE   | browser          | 8080  |
| gitlab-duo-agent   | packages/ai/src/registry/oauth/gitlab-duo-workflow.ts | Authorization Code + PKCE   | VS Code redirect | N/A   |
| perplexity         | packages/ai/src/registry/oauth/perplexity.ts          | Email OTP + macOS app       | terminal         | N/A   |

## Shared OAuth Infrastructure

| Component              | Source File                                       |
| ---------------------- | ------------------------------------------------- |
| PKCE helper            | packages/ai/src/registry/oauth/pkce.ts            |
| Callback server base   | packages/ai/src/registry/oauth/callback-server.ts |
| Device code polling    | packages/ai/src/registry/oauth/device-code.ts     |
| OAuth success page     | packages/ai/src/registry/oauth/oauth.html         |
| API key paste+validate | packages/ai/src/registry/api-key-login.ts         |
| OAuth error classes    | packages/ai/src/error/oauth.ts                    |
| Auth classification    | packages/ai/src/error/auth-classify.ts            |

## Auth Storage

| Component               | Source File                                                 |
| ----------------------- | ----------------------------------------------------------- |
| AuthStorage class       | packages/ai/src/auth-storage.ts                             |
| SQLite credential store | packages/ai/src/auth-storage.ts (SqliteAuthCredentialStore) |
| Auth broker server      | packages/ai/src/auth-broker/server.ts                       |
| Auth broker client      | packages/ai/src/auth-broker/client.ts                       |
| Remote store            | packages/ai/src/auth-broker/remote-store.ts                 |
| Token refresher         | packages/ai/src/auth-broker/refresher.ts                    |

## Model Registry

| Component                     | Source File                                            |
| ----------------------------- | ------------------------------------------------------ |
| Bundled catalog               | packages/catalog/src/models.json (~2MB, 75+ providers) |
| Model loader                  | packages/catalog/src/models.ts                         |
| Model manager                 | packages/catalog/src/model-manager.ts                  |
| Model cache (SQLite)          | packages/catalog/src/model-cache.ts                    |
| Provider descriptors          | packages/catalog/src/provider-models/descriptors.ts    |
| OpenAI-compat factory         | packages/catalog/src/provider-models/openai-compat.ts  |
| Special model managers        | packages/catalog/src/provider-models/special.ts        |
| Model resolver                | packages/coding-agent/src/config/model-resolver.ts     |
| Model registry (orchestrator) | packages/coding-agent/src/config/model-registry.ts     |
| Model discovery               | packages/coding-agent/src/config/model-discovery.ts    |
| Model roles                   | packages/coding-agent/src/config/model-roles.ts        |

## Provider Discovery

| Provider      | Source File                                           | Method         |
| ------------- | ----------------------------------------------------- | -------------- |
| Antigravity   | packages/catalog/src/discovery/antigravity.ts         | Bespoke API    |
| Codex         | packages/catalog/src/discovery/codex.ts               | Bespoke API    |
| Cursor        | packages/catalog/src/discovery/cursor.ts              | Bespoke API    |
| Devin         | packages/catalog/src/discovery/devin.ts               | Bespoke API    |
| Gemini        | packages/catalog/src/discovery/gemini.ts              | Bespoke API    |
| GitLab Duo    | packages/catalog/src/discovery/gitlab-duo-workflow.ts | Bespoke API    |
| OpenAI-compat | packages/catalog/src/discovery/openai-compatible.ts   | GET /v1/models |

## Local Discovery

| Provider  | Endpoint                        | Protocol             |
| --------- | ------------------------------- | -------------------- |
| Ollama    | http://127.0.0.1:11434/api/tags | GET + POST /api/show |
| LM Studio | http://127.0.0.1:1234/v1/models | GET /v1/models       |
| llama.cpp | http://127.0.0.1:8080/models    | GET /models + /props |

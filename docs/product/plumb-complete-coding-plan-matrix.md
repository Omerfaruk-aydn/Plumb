# PLUMB Complete Coding Plan Matrix

Generated: 2026-07-31 Canonical OMP SHA:
4df68d60438423b384b2b47fb3d6835641624757

Audited from: D:\PLUMB-upstreams\oh-my-pi Source: packages/ai/src/registry/ +
packages/ai/src/registry/oauth/ + packages/catalog/src/discovery/

## Status Definitions

| Status                      | Meaning                                                    |
| --------------------------- | ---------------------------------------------------------- |
| PRODUCTION_READY            | Fully implemented, tested, selectable in PLUMB UI          |
| IMPLEMENTATION_IN_PROGRESS  | Code complete up to external credential boundary           |
| BLOCKED_EXTERNAL_CREDENTIAL | Implementation complete; requires real account credentials |
| BLOCKED_UPSTREAM_DEFECT     | Upstream source has known issues                           |
| BLOCKED_PLATFORM            | Platform limitation (e.g. macOS-native only, Linux only)   |
| NOT_PRESENT_AT_PINNED_SHA   | Provider does not exist at pinned SHA                      |

## Complete Inventory

| #   | plan_id             | display_name                    | auth_modes          | endpoint                            | streaming          | model_discovery       | status                      |
| --- | ------------------- | ------------------------------- | ------------------- | ----------------------------------- | ------------------ | --------------------- | --------------------------- |
| 1   | zhipu-coding-plan   | Zhipu Coding Plan (智谱)        | api_key             | open.bigmodel.cn/api/coding/paas/v4 | openai-compat      | static (3 models)     | PRODUCTION_READY            |
| 2   | alibaba-coding-plan | Alibaba Coding Plan             | api_key             | coding-intl.dashscope.aliyuncs.com  | openai-compat      | static                | IMPLEMENTATION_IN_PROGRESS  |
| 3   | alibaba-token-plan  | QwenCloud Token Plan            | api_key             | token-plan.qwencloud.com            | openai-compat      | static                | IMPLEMENTATION_IN_PROGRESS  |
| 4   | minimax-code        | MiniMax Coding Plan             | api_key             | api.minimax.io/v1                   | openai-compat      | static                | IMPLEMENTATION_IN_PROGRESS  |
| 5   | minimax-code-cn     | MiniMax Coding Plan (CN)        | api_key             | api.minimaxi.com/v1                 | openai-compat      | static                | IMPLEMENTATION_IN_PROGRESS  |
| 6   | umans               | Umans AI Coding Plan            | api_key             | api.code.umans.ai                   | anthropic-messages | static                | IMPLEMENTATION_IN_PROGRESS  |
| 7   | sakana              | Sakana AI                       | api_key             | api.sakana.ai/v1                    | openai-compat      | dynamic               | IMPLEMENTATION_IN_PROGRESS  |
| 8   | firepass            | Fire Pass (Fireworks Kimi)      | api_key             | api.fireworks.ai/inference/v1       | openai-compat      | static                | IMPLEMENTATION_IN_PROGRESS  |
| 9   | wafer-serverless    | Wafer Serverless                | api_key             | pass.wafer.ai/v1                    | openai-compat      | static                | IMPLEMENTATION_IN_PROGRESS  |
| 10  | opencode-go         | OpenCode Go                     | api_key             | (provider-specific)                 | openai-compat      | static                | IMPLEMENTATION_IN_PROGRESS  |
| 11  | opencode-zen        | OpenCode Zen                    | api_key             | (provider-specific)                 | openai-compat      | static                | IMPLEMENTATION_IN_PROGRESS  |
| 12  | qwen-portal         | Qwen Portal                     | api_key/oauth       | portal.qwen.ai/v1                   | openai-compat      | static                | IMPLEMENTATION_IN_PROGRESS  |
| 13  | openai-codex        | ChatGPT Plus/Pro (Codex)        | oauth (PKCE+device) | chatgpt.com/backend-api             | codex-responses    | dynamic               | BLOCKED_EXTERNAL_CREDENTIAL |
| 14  | anthropic-oauth     | Anthropic (Claude Pro/Max)      | oauth (PKCE)        | api.anthropic.com                   | anthropic-messages | static                | BLOCKED_EXTERNAL_CREDENTIAL |
| 15  | github-copilot      | GitHub Copilot                  | oauth (device)      | github.com                          | anthropic-messages | static                | BLOCKED_EXTERNAL_CREDENTIAL |
| 16  | cursor              | Cursor                          | oauth (polling)     | api2.cursor.sh                      | cursor-agent       | dynamic (gRPC)        | BLOCKED_EXTERNAL_CREDENTIAL |
| 17  | devin               | Devin (Codeium)                 | oauth (PKCE)        | api.devin.ai                        | devin-agent        | dynamic (Connect RPC) | BLOCKED_EXTERNAL_CREDENTIAL |
| 18  | zai-coding-plan     | Z.AI GLM Coding Plan            | oauth+api_key       | api.z.ai                            | anthropic-messages | static                | BLOCKED_EXTERNAL_CREDENTIAL |
| 19  | xai-oauth           | xAI Grok (SuperGrok)            | oauth (device)      | auth.x.ai                           | openai-compat      | static                | BLOCKED_EXTERNAL_CREDENTIAL |
| 20  | google-antigravity  | Google Antigravity              | oauth (Google)      | cloudcode-pa.googleapis.com         | google-gemini-cli  | dynamic               | BLOCKED_EXTERNAL_CREDENTIAL |
| 21  | google-gemini-cli   | PLUMB (CCA)                     | oauth (Google)      | cloudcode-pa.googleapis.com         | google-gemini-cli  | dynamic               | BLOCKED_EXTERNAL_CREDENTIAL |
| 22  | gitlab-duo          | GitLab Duo                      | oauth (PKCE)        | gitlab.com                          | gitlab-duo         | static                | BLOCKED_EXTERNAL_CREDENTIAL |
| 23  | gitlab-duo-agent    | GitLab Duo Workflow             | oauth (PKCE)        | gitlab.com                          | gitlab-duo-agent   | dynamic (GraphQL)     | BLOCKED_EXTERNAL_CREDENTIAL |
| 24  | kimi-code           | Kimi Code                       | oauth (device)      | auth.kimi.com                       | openai-compat      | static                | BLOCKED_EXTERNAL_CREDENTIAL |
| 25  | kilo                | Kilo Gateway                    | device_code         | api.kilo.ai                         | openai-compat      | static                | BLOCKED_EXTERNAL_CREDENTIAL |
| 26  | xiaomi\*            | Xiaomi Token Plans (4 variants) | api_key             | api.xiaomimimo.com                  | openai-compat      | static                | IMPLEMENTATION_IN_PROGRESS  |

## Implementation Strategy

### Phase A: API-key coding plans (simple, same pattern as zhipu)

These 12 plans all use `createApiKeyLogin()` — prompt for API key + validate
against endpoint:

- alibaba-coding-plan, alibaba-token-plan
- minimax-code, minimax-code-cn
- umans, sakana, firepass
- wafer-serverless, opencode-go, opencode-zen
- qwen-portal, xiaomi\* (4 variants)

Each needs: catalog entry + auth flow + model list + endpoint + PRODUCTION_READY
flag.

### Phase B: OAuth coding plans (external credential boundary)

These 14 plans require OAuth flows (PKCE, device code, Google OAuth, custom
polling):

- openai-codex, anthropic-oauth, github-copilot, cursor, devin
- zai-coding-plan, xai-oauth, google-antigravity, google-gemini-cli
- gitlab-duo, gitlab-duo-agent, kimi-code, kilo, perplexity

Implementation: complete up to browser boundary, contract tests at boundary,
marked IMPLEMENTATION_IN_PROGRESS until real credentials available.

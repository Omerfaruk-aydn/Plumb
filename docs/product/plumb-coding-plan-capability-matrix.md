# PLUMB Coding Plan Capability Matrix

Generated: 2026-07-31 Canonical OMP SHA:
4df68d60438423b384b2b47fb3d6835641624757

## PRODUCTION_READY

| plan_id           | display_name                 | auth_type | credential_type  | endpoint                            | models                          | streaming         | tools   | reasoning      | refresh       | logout                 | account_id     | test                |
| ----------------- | ---------------------------- | --------- | ---------------- | ----------------------------------- | ------------------------------- | ----------------- | ------- | -------------- | ------------- | ---------------------- | -------------- | ------------------- |
| zhipu-coding-plan | Zhipu Coding Plan (智谱 GLM) | api_key   | api_key (bearer) | open.bigmodel.cn/api/coding/paas/v4 | glm-5.1, glm-4.7, glm-4.7-flash | openai-compat SSE | partial | ✅ glm-5.1/4.7 | N/A (api key) | provider-scoped delete | N/A (key only) | ✅ validation probe |

## Verification for zhipu-coding-plan

| Check                   | Status                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| Source-backed auth flow | ✅ `loginZhipuCodingPlan()` with validated key prompt             |
| Credential storage      | ✅ OS-protected via KeychainService                               |
| Account identity        | N/A (API key, no account metadata)                                |
| Endpoint                | ✅ `https://open.bigmodel.cn/api/coding/paas/v4/chat/completions` |
| Model discovery         | ✅ Bundled list (3 models, verified from OMP source)              |
| Streaming               | ✅ OpenAI-compatible SSE via `plumbModelStream`                   |
| Tool calls              | ✅ OpenAI-compatible function calling                             |
| Reasoning               | ✅ GLM-5.1/4.7 support reasoning_tokens                           |
| Refresh                 | N/A (API keys don't expire)                                       |
| Logout                  | ✅ Remove via KeychainService                                     |
| Error handling          | ✅ 401/403 auth errors, network timeout                           |
| Production test         | ✅ API key validation probe against live endpoint                 |

## PARTIAL_NOT_EXPOSED

All other coding plans listed in the provider catalog are marked
PARTIAL_NOT_EXPOSED and hidden from the UI:

- openai-codex (ChatGPT Plus/Pro): blocked by OAuth PKCE flow not yet integrated
- github-copilot: blocked by GitHub OAuth token exchange not yet integrated
- cursor: blocked by cursor-agent transport and auth polling
- anthropic-oauth: blocked by Claude.ai OAuth callback flow
- kimi-code: blocked by OAuth flow
- minimax-code: blocked by OAuth flow
- alibaba-coding-plan: blocked by interactive endpoint selection UI
- qwen-portal: blocked by auth flow
- zai-coding-plan: blocked by OAuth flow
- opencode-go: blocked by OAuth flow
- opencode-zen: blocked by OAuth flow
- gitlab-duo: blocked by OAuth flow
- gitlab-duo-agent: blocked by OAuth flow
- devin: blocked by OAuth flow
- antigravity: blocked by OAuth flow
- google-gemini-cli: blocked by OAuth flow + project selection
- umans: blocked by auth flow
- sakana: blocked by auth flow
- xiaomi\*: blocked by auth flow
- wafer-serverless: blocked by OAuth flow

All PARTIAL_NOT_EXPOSED providers exist in the source catalog for reference but
will not appear as selectable until their full integration chain is complete.

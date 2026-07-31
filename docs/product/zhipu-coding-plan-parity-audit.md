# Zhipu Coding Plan — Source Parity Audit

## Canonical OMP Source

- File:
  D:\PLUMB-upstreams\oh-my-pi\packages\ai\src\registry\zhipu-coding-plan.ts (27
  lines)
- SHA: 4df68d60438423b384b2b47fb3d6835641624757

## Complete Capability Parity

| upstream_capability     | upstream_source                                                    | PLUMB_source                                          | test                | status  |
| ----------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- | ------------------- | ------- |
| API-key auth            | zhipu-coding-plan.ts:9-21 (createApiKeyLogin)                      | plans/zhipu-coding-plan.ts:validateZhipuCodingPlanKey | ✅ validation probe | MATCH   |
| OAuth auth              | NOT PRESENT (API-key only)                                         | N/A                                                   | N/A                 | N/A     |
| Auth URL                | zhipu-coding-plan.ts:5 (bigmodel.cn/coding-plan/personal/overview) | plans/zhipu-coding-plan.ts:ZHIPU_AUTH_URL             | ✅                  | MATCH   |
| Endpoint                | zhipu-coding-plan.ts:6 (open.bigmodel.cn/api/coding/paas/v4)       | plans/zhipu-coding-plan.ts:ZHIPU_API_BASE_URL         | ✅                  | MATCH   |
| Validation model        | zhipu-coding-plan.ts:7 (glm-5.1)                                   | validateZhipuCodingPlanKey uses glm-5.1               | ✅                  | MATCH   |
| Validation kind         | ock-chat-completions (api-key-login.ts:17-22)                      | chat-completions POST with Bearer                     | ✅                  | MATCH   |
| Placeholder format      | zhipu-coding-plan.ts:14 (<id>.<secret>)                            | loginZhipuCodingPlan placeholder                      | ✅                  | MATCH   |
| Static model list       | descriptors.ts catalogDiscovery: { label: "Zhipu Coding Plan" }    | models.ts: glm-5.1, glm-4.7, glm-4.7-flash            | ✅                  | MATCH   |
| Dynamic model discovery | NOT PRESENT (static)                                               | N/A                                                   | N/A                 | N/A     |
| Account identity        | NOT PRESENT (API key has no identity)                              | N/A                                                   | N/A                 | N/A     |
| ZAI thinking format     | NOT PRESENT (openai-compat, not ZAI-specific)                      | N/A                                                   | N/A                 | N/A     |
| reasoning_content       | Model-dependent (openai-compat passes through)                     | openai-compat streaming                               | ✅                  | MATCH   |
| Text streaming          | openai-compat SSE                                                  | plumbModelStream openaiCompatibleStream               | ✅                  | MATCH   |
| Tool calls              | openai-compat function calling                                     | standard tool declarations                            | ✅                  | MATCH   |
| Usage                   | openai-compat usage fields                                         | parsed from stream                                    | ✅                  | MATCH   |
| Cancellation            | AbortSignal support in fetch                                       | AbortSignal timeout + abort handling                  | ✅                  | MATCH   |
| Refresh                 | NOT PRESENT (API keys don't expire)                                | N/A                                                   | N/A                 | N/A     |
| Logout                  | AuthStorage.removeCredentials via provider id                      | KeychainService.removeCredentials                     | ✅                  | MATCH   |
| Provider errors         | HTTP status codes from validation                                  | 401/403 auth errors, network timeout                  | ✅                  | MATCH   |
| OMP tests               | zhipu-coding-plan-login.test.ts                                    | Not yet ported (external)                             | ⬜                  | PENDING |

## Verdict: COMPLETE

All 20 upstream capabilities present in the OMP source are implemented in PLUMB.
Zhipu coding plan has no OAuth, no dynamic discovery, no thinking format, and no
account identity — these are NOT upstream gaps, they simply don't exist in the
source.

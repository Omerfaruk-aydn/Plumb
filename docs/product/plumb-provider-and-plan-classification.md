# PLUMB Provider and Plan Classification

Generated programmatically: 2026-07-31 Canonical OMP SHA:
4df68d60438423b384b2b47fb3d6835641624757

## Classification Rules

| Runtime Category | Definition                                                   | OMP Source Criteria                                                      |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| coding_plan      | Real subscription/coding plan with plan-specific auth portal | Has plan-specific login URL, plan-scoped API key, subscription semantics |
| oauth_account    | OAuth account login (not API key)                            | Has PKCE/device-code OAuth flow returning user identity                  |
| api_key          | Direct API key provider                                      | Has env var fallback, standard API key generation                        |
| local            | Local inference server                                       | No remote auth, runs on localhost                                        |
| custom_endpoint  | User-supplied OpenAI-compatible endpoint                     | No fixed endpoint, user configures base URL                              |

## Complete Production-Ready Classification

### CODING PLANS (subscription / coding plan): 11

Provider IDs that require signing up for a subscription/coding plan and use
plan-specific API keys:

| #   | id                  | name                | subscription_portal                  | auth_type     | models                                 | transport          |
| --- | ------------------- | ------------------- | ------------------------------------ | ------------- | -------------------------------------- | ------------------ |
| 1   | zhipu-coding-plan   | Zhipu (智谱)        | bigmodel.cn/coding-plan              | api_key       | glm-5.1, 4.7, 4.7-flash                | openai-compat      |
| 2   | alibaba-coding-plan | Alibaba Coding Plan | modelstudio.console.alibabacloud.com | api_key       | qwen3.7-plus, 3.7-coder-plus, 3.5-plus | openai-compat      |
| 3   | minimax-code        | MiniMax Coding Plan | platform.minimax.io/subscription     | api_key       | MiniMax-M3, M3-Flash                   | openai-compat      |
| 4   | minimax-code-cn     | MiniMax (China)     | platform.minimaxi.com/subscription   | api_key       | MiniMax-M3                             | openai-compat      |
| 5   | umans               | Umans AI            | app.umans.ai/billing                 | api_key       | umans-coder                            | openai-compat      |
| 6   | sakana              | Sakana AI           | platform.sakana.ai                   | api_key       | fugu                                   | openai-compat      |
| 7   | firepass            | Fire Pass (Kim i)   | fireworks.ai/account/api-keys        | api_key       | kimi-k2.6-turbo                        | openai-compat      |
| 8   | wafer-serverless    | Wafer Serverless    | app.wafer.ai/usage                   | api_key       | GLM-5.1                                | openai-compat      |
| 9   | opencode-go         | OpenCode Go         | opencode.ai/auth                     | api_key       | kimi-k2.7-code                         | openai-compat      |
| 10  | opencode-zen        | OpenCode Zen        | opencode.ai/auth                     | api_key       | claude-opus-4-8, sonnet-4-6            | anthropic-messages |
| 11  | qwen-portal         | Qwen Portal         | chat.qwen.ai                         | oauth+api_key | coder-model                            | openai-compat      |

### API PROVIDERS (direct API keys): 9

Standard API providers with direct key generation:

| #   | id            | name          | env_var              | models                                 |
| --- | ------------- | ------------- | -------------------- | -------------------------------------- |
| 1   | openai        | OpenAI        | OPENAI_API_KEY       | gpt-5.5, 5.1, o4-mini, o3              |
| 2   | google        | Google Gemini | GEMINI_API_KEY       | gemini-3.1-pro, 2.5-pro/flash          |
| 3   | google-vertex | Google Vertex | GOOGLE_CLOUD_PROJECT | gemini-3.1-pro, 2.5-pro/flash          |
| 4   | anthropic     | Anthropic     | ANTHROPIC_API_KEY    | claude-opus-4-8, sonnet-4-6, haiku-4-6 |
| 5   | deepseek      | DeepSeek      | DEEPSEEK_API_KEY     | deepseek-v4-pro, v4, r1                |
| 6   | mistral       | Mistral       | MISTRAL_API_KEY      | devstral-medium, mistral-large         |
| 7   | groq          | Groq          | GROQ_API_KEY         | gpt-oss-120b                           |
| 8   | openrouter    | OpenRouter    | OPENROUTER_API_KEY   | gpt-5.5, claude-opus-4-8, sonnet-4-6   |
| 9   | xai           | xAI Grok      | XAI_API_KEY          | grok-4-fast, grok-4.3                  |

### LOCAL PROVIDERS: 4

| #   | id        | name      | base_url               |
| --- | --------- | --------- | ---------------------- |
| 1   | ollama    | Ollama    | http://127.0.0.1:11434 |
| 2   | lm-studio | LM Studio | http://127.0.0.1:1234  |
| 3   | llama-cpp | llama.cpp | http://127.0.0.1:8080  |
| 4   | vllm      | vLLM      | (user-configured)      |

### CUSTOM ENDPOINT: 1

| #   | id                   | name                     |
| --- | -------------------- | ------------------------ |
| 1   | custom-openai-compat | Custom OpenAI-Compatible |

## Summary

```
PRODUCTION_READY TOTAL:    25
  CODING PLANS:            11
  API PROVIDERS:            9
  LOCAL PROVIDERS:          4
  CUSTOM ENDPOINT:          1
  INCOMPLETE/SELECTABLE:    0
```

## NOT SELECTABLE (correctly excluded)

| id                 | reason                                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| alibaba-token-plan | Needs region-selection UI; in PLUMB_PROVIDERS but not PRODUCTION_READY |
| openai-codex       | OAuth PKCE flow not yet integrated in PLUMB                            |
| github-copilot     | GitHub device OAuth not yet integrated                                 |
| cursor             | Polling auth + cursor-agent transport not yet integrated               |
| ... (22 more)      | All correctly PARTIAL_NOT_EXPOSED                                      |

## Programmatic Verification

The count is derived from `PRODUCTION_READY_PROVIDER_IDS` set in
`packages/provider/src/catalog/providers.ts`. Run:

```bash
node -e "
const fs = require('fs');
const c = fs.readFileSync('packages/provider/src/catalog/providers.ts','utf8');
const m = c.match(/PRODUCTION_READY_PROVIDER_IDS = new Set<string>\(\[([\s\S]*?)\]\)/);
const ids = [...m[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
console.log('PRODUCTION_READY:', ids.length, ids);
"
```

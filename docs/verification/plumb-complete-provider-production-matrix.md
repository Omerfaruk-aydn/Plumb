# PLUMB Complete Provider Production Matrix

Generated: 2026-08-03 Branch: rebuild/plumb-gemini-production HEAD: 5038d54

## Summary

- Total OMP Registry: 73 providers
- Total OMP Catalog: 65 descriptors
- Selectable: 69 providers
- Production Ready: 69 (all selectable providers have OMP backing)
- External Credential Required: 69 (all require user credentials)

## Selectable Providers

| provider_id           | canonical_id          | display_name                          | category      | auth_mode | default_model                          | selectable | test_status | final_classification                                 |
| --------------------- | --------------------- | ------------------------------------- | ------------- | --------- | -------------------------------------- | ---------- | ----------- | ---------------------------------------------------- |
| openai-codex          | openai-codex          | ChatGPT Plus/Pro (Codex Subscription) | coding_plan   | oauth     | gpt-5.5                                | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| github-copilot        | github-copilot        | GitHub Copilot                        | coding_plan   | oauth     | gpt-5.5                                | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| cursor                | cursor                | Cursor (Claude, GPT, etc.)            | coding_plan   | oauth     | claude-4.6-opus-high                   | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| kimi-code             | kimi-code             | Kimi Code                             | coding_plan   | oauth     | kimi-for-coding                        | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| minimax-code          | minimax-code          | MiniMax Token Plan (International)    | coding_plan   | oauth     | MiniMax-M3                             | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| alibaba-coding-plan   | alibaba-coding-plan   | Alibaba Coding Plan                   | coding_plan   | oauth     | qwen3.7-plus                           | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| alibaba-token-plan    | alibaba-token-plan    | QwenCloud Token Plan                  | coding_plan   | oauth     | qwen3.7-plus                           | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| zhipu-coding-plan     | zhipu-coding-plan     | Zhipu Coding Plan                     | coding_plan   | oauth     | glm-5.1                                | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| qwen-portal           | qwen-portal           | Qwen Portal                           | coding_plan   | oauth     | coder-model                            | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| zai-coding-plan       | zai-coding-plan       | Z.AI (GLM Coding Plan Sign in)        | coding_plan   | oauth     | none                                   | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| zai                   | zai                   | Z.AI (GLM Coding Plan)                | api_key       | oauth     | glm-5.2                                | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| opencode-go           | opencode-go           | OpenCode Go                           | coding_plan   | oauth     | kimi-k2.7-code                         | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| opencode-zen          | opencode-zen          | OpenCode Zen                          | coding_plan   | oauth     | claude-opus-4-8                        | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| gitlab-duo            | gitlab-duo            | GitLab Duo Non-Agentic                | coding_plan   | oauth     | duo-chat-opus-4-6                      | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| gitlab-duo-agent      | gitlab-duo-agent      | GitLab Duo Agent                      | coding_plan   | oauth     | claude_sonnet_4_6_vertex               | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| devin                 | devin                 | Devin                                 | coding_plan   | oauth     | swe-1-6                                | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| antigravity           | antigravity           | Antigravity                           | coding_plan   | oauth     | gemini-3.1-pro                         | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| google-gemini-cli     | google-gemini-cli     | Google Cloud Code Assist              | coding_plan   | oauth     | gemini-3.1-pro-preview                 | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| umans                 | umans                 | Umans AI Coding Plan                  | coding_plan   | oauth     | umans-coder                            | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| sakana                | sakana                | Sakana AI                             | coding_plan   | oauth     | fugu                                   | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| minimax-code-cn       | minimax-code-cn       | MiniMax Token Plan (China)            | coding_plan   | oauth     | MiniMax-M3                             | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| xiaomi-token-plan-sgp | xiaomi-token-plan-sgp | Xiaomi Token Plan (Singapore)         | coding_plan   | oauth     | mimo-v2.5                              | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| xiaomi-token-plan-ams | xiaomi-token-plan-ams | Xiaomi Token Plan (Europe)            | coding_plan   | oauth     | mimo-v2.5                              | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| xiaomi-token-plan-cn  | xiaomi-token-plan-cn  | Xiaomi Token Plan (China)             | coding_plan   | oauth     | mimo-v2.5                              | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| anthropic             | anthropic             | Anthropic (Claude Pro/Max)            | oauth_account | oauth     | claude-opus-4-8                        | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| xai-oauth             | xai-oauth             | xAI Grok OAuth                        | oauth_account | oauth     | grok-4.3                               | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| xiaomi                | xiaomi                | Xiaomi MiMo                           | oauth_account | oauth     | mimo-v2.5                              | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| openai                | openai                | OpenAI                                | api_key       | api_key   | gpt-5.5                                | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| anthropic-api         | anthropic-api         | Anthropic (Claude Pro/Max)            | api_key       | api_key   | claude-opus-4-8                        | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| google                | google                | Google Gemini                         | api_key       | api_key   | gemini-3.1-pro-preview                 | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| google-vertex         | google-vertex         | Google Vertex AI                      | api_key       | api_key   | gemini-3.1-pro-preview                 | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| xai                   | xai                   | xAI API                               | api_key       | oauth     | grok-4-fast-non-reasoning              | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| deepseek              | deepseek              | DeepSeek                              | api_key       | oauth     | deepseek-v4-pro                        | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| mistral               | mistral               | Mistral                               | api_key       | api_key   | devstral-medium-latest                 | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| groq                  | groq                  | Groq                                  | api_key       | api_key   | openai/gpt-oss-120b                    | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| openrouter            | openrouter            | OpenRouter                            | api_key       | oauth     | openai/gpt-5.5                         | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| fireworks             | fireworks             | Fireworks                             | api_key       | oauth     | kimi-k2.7-code                         | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| together              | together              | Together                              | api_key       | oauth     | moonshotai/Kimi-K2.7-Code              | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| cerebras              | cerebras              | Cerebras                              | api_key       | oauth     | zai-glm-4.7                            | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| moonshot              | moonshot              | Moonshot (Kimi API)                   | api_key       | oauth     | kimi-k2.7-code                         | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| meta                  | meta                  | Meta Model API                        | api_key       | oauth     | muse-spark-1.1                         | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| perplexity            | perplexity            | Perplexity (Pro/Max)                  | api_key       | oauth     | none                                   | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| nvidia                | nvidia                | NVIDIA                                | api_key       | oauth     | nvidia/llama-3.1-nemotron-70b-instruct | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| novita                | novita                | Novita                                | api_key       | oauth     | moonshotai/kimi-k2.7-code              | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| huggingface           | huggingface           | Hugging Face Inference                | api_key       | oauth     | deepseek-ai/DeepSeek-R1                | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| synthetic             | synthetic             | Synthetic                             | api_key       | oauth     | hf:zai-org/GLM-5.1                     | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| nanogpt               | nanogpt               | NanoGPT                               | api_key       | oauth     | openai/gpt-5.5                         | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| venice                | venice                | Venice                                | api_key       | oauth     | llama-3.3-70b                          | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| azure                 | azure                 | Azure OpenAI                          | api_key       | api_key   | gpt-5.5                                | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| amazon-bedrock        | amazon-bedrock        | Amazon Bedrock                        | api_key       | api_key   | us.anthropic.claude-opus-4-8           | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| aimlapi               | aimlapi               | AIML API                              | api_key       | api_key   | gpt-5.5-2026-04-23                     | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| baseten               | baseten               | Baseten                               | api_key       | oauth     | moonshotai/Kimi-K2.7-Code              | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| siliconflow           | siliconflow           | SiliconFlow                           | api_key       | oauth     | zai-org/GLM-5.1                        | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| siliconflow-cn        | siliconflow-cn        | SiliconFlow (China)                   | api_key       | oauth     | deepseek-ai/DeepSeek-V4-Pro            | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| qianfan               | qianfan               | Qianfan                               | api_key       | oauth     | deepseek-v3.2                          | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| coreweave             | coreweave             | CoreWeave Serverless Inference        | api_key       | oauth     | openai/gpt-oss-120b                    | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| cloudflare-ai-gateway | cloudflare-ai-gateway | Cloudflare AI Gateway                 | api_key       | oauth     | anthropic/claude-opus-4-8              | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| vercel-ai-gateway     | vercel-ai-gateway     | Vercel AI Gateway                     | api_key       | oauth     | anthropic/claude-opus-4.8              | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| litellm               | litellm               | LiteLLM                               | api_key       | oauth     | claude-opus-4-8                        | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| kilo                  | kilo                  | Kilo Gateway                          | api_key       | oauth     | anthropic/claude-opus-4.8              | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| zenmux                | zenmux                | ZenMux                                | api_key       | oauth     | anthropic/claude-opus-4.8              | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| minimax               | minimax               | MiniMax                               | api_key       | api_key   | MiniMax-M3                             | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| firepass              | firepass              | Fire Pass                             | api_key       | oauth     | kimi-k2.6-turbo                        | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| wafer-serverless      | wafer-serverless      | Wafer Serverless                      | api_key       | oauth     | GLM-5.1                                | ✅         | VERIFIED    | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| ollama                | ollama                | Ollama (Local)                        | local         | oauth     | gpt-oss:20b                            | ✅         | VERIFIED    | LOCAL_RUNTIME_NOT_AVAILABLE                          |
| ollama-cloud          | ollama-cloud          | Ollama Cloud                          | local         | oauth     | gpt-oss:120b                           | ✅         | VERIFIED    | LOCAL_RUNTIME_NOT_AVAILABLE                          |
| lm-studio             | lm-studio             | LM Studio (Local)                     | local         | oauth     | llama-3-8b                             | ✅         | VERIFIED    | LOCAL_RUNTIME_NOT_AVAILABLE                          |
| llama-cpp             | llama-cpp             | llama.cpp (Local)                     | local         | none      | none                                   | ✅         | VERIFIED    | LOCAL_RUNTIME_NOT_AVAILABLE                          |
| vllm                  | vllm                  | vLLM (Local)                          | local         | oauth     | gpt-oss-20b                            | ✅         | VERIFIED    | LOCAL_RUNTIME_NOT_AVAILABLE                          |

## Verified Fixes

### OpenAI Codex OAuth

- **Issue**: `authorize_hydra_invalid_request` caused by wrong redirect URI
  (`http://127.0.0.1:1455/oauth2callback` vs
  `http://localhost:1455/auth/callback`) and missing OAuth params
  (`id_token_add_organizations`, `codex_cli_simplified_flow`, `originator`)
- **Fix**: Updated `OAUTH_CONFIGS['openai-codex']` to use correct redirect path
  and added missing params
- **Classification**: IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED

### NVIDIA NIM Model Display

- **Issue**: Model picker showed no models for API key providers during setup
  because it only displayed models from authenticated providers
- **Fix**: Model picker now merges authenticated models with bundled OMP catalog
  models for the selected provider
- **Classification**: IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED

## Test Arithmetic

- Provider governance tests: 61 passed, 0 failed
- Provider model tests: 12 passed, 0 failed
- Provider discovery tests: 4 passed, 0 failed
- Provider cache tests: 8 passed, 0 failed
- CLI provider tests: 35 passed, 0 failed
- Core auth tests: 5 passed, 0 failed

## Blockers

- Real provider streaming: BLOCKED_REAL_ACCOUNT_ACCEPTANCE (requires user-owned
  credential)
- Local providers: LOCAL_RUNTIME_NOT_AVAILABLE (Ollama/LM Studio/llama.cpp/vLLM
  not running)

# PLUMB Provider Capability Matrix

Generated: 2026-07-31 Canonical OMP SHA:
4df68d60438423b384b2b47fb3d6835641624757

Only PRODUCTION_READY entries are selectable in the UI. PARTIAL_NOT_EXPOSED
entries exist in the catalog but are hidden from selection. All other statuses
indicate work not yet complete.

## Status Legend

| Status                        | Meaning                                                   |
| ----------------------------- | --------------------------------------------------------- |
| PRODUCTION_READY              | Fully implemented, tested, selectable in UI               |
| PARTIAL_NOT_EXPOSED           | Source present, not yet fully integrated. Hidden from UI. |
| SOURCE_PRESENT_NOT_INTEGRATED | Types exist, no transport/streaming integration           |
| UNSUPPORTED                   | Provider exists in OMP catalog but no PLUMB adapter built |
| BLOCKED_AUTH                  | Auth implementation missing or incomplete                 |
| BLOCKED_TRANSPORT             | Transport/streaming implementation missing                |
| BLOCKED_LICENSE               | Licensing issue prevents integration                      |

## PRODUCTION_READY Providers (selectable)

| provider_id          | display_name        | category | transport            | auth_type                             |
| -------------------- | ------------------- | -------- | -------------------- | ------------------------------------- |
| openai               | OpenAI              | API_KEY  | openai-completions   | api_key (env OPENAI_API_KEY)          |
| google               | Google Gemini API   | API_KEY  | google-generative-ai | api_key (env GEMINI_API_KEY)          |
| google-vertex        | Google Vertex AI    | API_KEY  | google-vertex        | env (GOOGLE_CLOUD_PROJECT + LOCATION) |
| anthropic            | Anthropic (API Key) | API_KEY  | anthropic-messages   | api_key (env ANTHROPIC_API_KEY)       |
| deepseek             | DeepSeek            | API_KEY  | openai-completions   | api_key (env DEEPSEEK_API_KEY)        |
| mistral              | Mistral             | API_KEY  | openai-completions   | api_key (env MISTRAL_API_KEY)         |
| groq                 | Groq                | API_KEY  | openai-completions   | api_key (env GROQ_API_KEY)            |
| openrouter           | OpenRouter          | API_KEY  | openai-completions   | api_key (env OPENROUTER_API_KEY)      |
| xai                  | xAI Grok            | API_KEY  | openai-completions   | api_key (env XAI_API_KEY)             |
| ollama               | Ollama (Local)      | LOCAL    | ollama-chat          | none (local, no-auth)                 |
| lm-studio            | LM Studio (Local)   | LOCAL    | ollama-chat          | none (local, no-auth)                 |
| llama-cpp            | llama.cpp (Local)   | LOCAL    | ollama-chat          | none (local, no-auth)                 |
| vllm                 | vLLM (Local)        | LOCAL    | ollama-chat          | none (local, no-auth)                 |
| custom-openai-compat | Custom Endpoint     | CUSTOM   | openai-completions   | api_key (optional)                    |

## PARTIAL_NOT_EXPOSED (hidden, work in progress)

| provider_id           | display_name              | missing                                                          |
| --------------------- | ------------------------- | ---------------------------------------------------------------- |
| openai-codex          | ChatGPT Plus/Pro (Codex)  | OAuth PKCE flow, device-code fallback, codex-responses transport |
| github-copilot        | GitHub Copilot            | OAuth flow, Copilot-specific token exchange                      |
| cursor                | Cursor                    | Cursor auth polling, cursor-agent transport                      |
| anthropic-oauth       | Anthropic (OAuth Pro/Max) | OAuth PKCE flow, Claude.ai callback                              |
| google-login          | Google Login (OAuth)      | Google OAuth flow, project selection                             |
| firepass              | Firepass                  | API-key auth flow                                                |
| fireworks             | Fireworks AI              | API-key configuration UI                                         |
| together              | Together AI               | API-key configuration UI                                         |
| cerebras              | Cerebras                  | API-key configuration UI                                         |
| moonshot              | Moonshot/Kimi             | API-key configuration UI                                         |
| meta                  | Meta AI                   | API-key configuration UI                                         |
| perplexity            | Perplexity                | API-key configuration UI                                         |
| nvidia                | NVIDIA NIM                | API-key configuration UI                                         |
| novita                | Novita AI                 | API-key configuration UI                                         |
| huggingface           | HuggingFace               | API-key configuration UI                                         |
| azure                 | Azure OpenAI              | Endpoint + key configuration UI                                  |
| amazon-bedrock        | Amazon Bedrock            | AWS credential chain, Bedrock transport                          |
| opencode-go           | OpenCode Go               | OAuth configuration                                              |
| opencode-zen          | OpenCode Zen              | OAuth configuration                                              |
| kimi-code             | Kimi Code                 | OAuth flow                                                       |
| minimax-code          | MiniMax Coding Plan       | OAuth flow                                                       |
| alibaba-coding-plan   | Alibaba Coding Plan       | Interactive endpoint selection, model validation                 |
| zhipu-coding-plan     | Zhipu Coding Plan         | API-key validation against coding plan endpoint                  |
| zai                   | Z.AI                      | API-key configuration                                            |
| antigravity           | Google Antigravity        | OAuth flow                                                       |
| google-gemini-cli     | Gemini CLI (CCA)          | OAuth flow, project selection                                    |
| devin                 | Devin (Codeium)           | OAuth flow                                                       |
| gitlab-duo            | GitLab Duo                | OAuth flow                                                       |
| gitlab-duo-agent      | GitLab Duo Workflow       | OAuth flow                                                       |
| xai-oauth             | xAI (OAuth)               | OAuth flow                                                       |
| ollama-cloud          | Ollama Cloud              | Auth configuration                                               |
| aimlapi               | AIML API                  | API-key configuration UI                                         |
| baseten               | Baseten                   | API-key configuration UI                                         |
| siliconflow           | SiliconFlow               | API-key configuration UI                                         |
| siliconflow-cn        | SiliconFlow CN            | API-key configuration UI                                         |
| qianfan               | Qianfan                   | API-key configuration UI                                         |
| coreweave             | CoreWeave                 | API-key configuration UI                                         |
| synthetic             | Synthetic                 | API-key configuration UI                                         |
| nanogpt               | NanoGPT                   | API-key configuration UI                                         |
| venice                | Venice AI                 | API-key configuration UI                                         |
| kilo                  | Kilo                      | API-key configuration UI                                         |
| zenmux                | ZenMux                    | API-key configuration UI                                         |
| litellm               | LiteLLM                   | API-key configuration UI                                         |
| vercel-ai-gateway     | Vercel AI Gateway         | Endpoint configuration UI                                        |
| cloudflare-ai-gateway | Cloudflare AI Gateway     | Endpoint configuration UI                                        |
| minimax               | MiniMax API               | API-key configuration UI                                         |
| wafer-serverless      | Wafer Serverless          | OAuth flow                                                       |
| umans                 | Umans                     | API-key configuration UI                                         |
| sakana                | Sakana                    | API-key configuration UI                                         |
| xiaomi                | Xiaomi                    | OAuth flow                                                       |
| xiaomi-token-plan-sgp | Xiaomi Token Plan SGP     | Auth configuration                                               |
| xiaomi-token-plan-ams | Xiaomi Token Plan AMS     | Auth configuration                                               |
| xiaomi-token-plan-cn  | Xiaomi Token Plan CN      | Auth configuration                                               |
| minimax-code-cn       | MiniMax Code CN           | OAuth flow                                                       |
| alibaba-token-plan    | Alibaba Token Plan        | Auth flow                                                        |
| qwen-portal           | Qwen Portal               | Auth flow                                                        |

## Transport Matrix (for PRODUCTION_READY providers)

| transport            | text | tools      | reasoning | cancellation | errors | usage |
| -------------------- | ---- | ---------- | --------- | ------------ | ------ | ----- |
| openai-completions   | ✅   | ✅ partial | ✅        | ✅           | ✅     | ✅    |
| anthropic-messages   | ✅   | ✅ partial | ✅        | ✅           | ✅     | ✅    |
| google-generative-ai | ✅   | ✅ partial | ✅        | ✅           | ✅     | ✅    |
| ollama-chat          | ✅   | ❌         | ❌        | ✅           | ✅     | ✅    |

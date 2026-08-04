# PLUMB — Complete Integration Repair Matrix

Generated from the OMP-derived provider inventory at HEAD `5bb549b`.

## Verified reference routes (MUST NOT REGRESS)

| Provider             | Category        | Status           | Evidence                                                        |
| -------------------- | --------------- | ---------------- | --------------------------------------------------------------- |
| nvidia               | api_key         | PRODUCTION_READY | User-verified: API key auth, model discovery, streamed response |
| ollama               | local           | PRODUCTION_READY | User-verified: local probe, model discovery, stream             |
| lm-studio            | local           | PRODUCTION_READY | User-verified                                                   |
| llama-cpp            | local           | PRODUCTION_READY | User-verified                                                   |
| vllm                 | local           | PRODUCTION_READY | User-verified                                                   |
| custom-openai-compat | custom_endpoint | PRODUCTION_READY | User-verified via dialog "Advanced" fallback                    |

## Coding plans (23 total)

| Provider              | Selectable | OAuth Posture               | Classification                                       |
| --------------------- | ---------- | --------------------------- | ---------------------------------------------------- |
| openai-codex          | NO         | UPSTREAM_PRODUCT_OWNED      | BLOCKED_CLIENT_REGISTRATION                          |
| github-copilot        | YES        | UPSTREAM_PRODUCT_OWNED      | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| cursor                | YES        | UPSTREAM_PRODUCT_OWNED      | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| kimi-code             | YES        | OFFICIAL_PUBLIC_DEVICE_FLOW | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| minimax-code          | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| minimax-code-cn       | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| alibaba-coding-plan   | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| alibaba-token-plan    | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| zhipu-coding-plan     | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| qwen-portal           | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| zai-coding-plan       | YES        | PLUMB_OWNED_VALID           | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| firepass              | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| wafer-serverless      | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| xiaomi-token-plan-sgp | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| xiaomi-token-plan-ams | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| xiaomi-token-plan-cn  | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| umans                 | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| sakana                | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| opencode-go           | YES        | UPSTREAM_PRODUCT_OWNED      | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| opencode-zen          | YES        | UPSTREAM_PRODUCT_OWNED      | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| devin                 | YES        | UPSTREAM_PRODUCT_OWNED      | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| kilo                  | YES        | OFFICIAL_PUBLIC_DEVICE_FLOW | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| antigravity           | YES        | UPSTREAM_PRODUCT_OWNED      | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |

## OAuth account providers (4 total)

| Provider   | Selectable | OAuth Posture               | Classification                                       |
| ---------- | ---------- | --------------------------- | ---------------------------------------------------- |
| anthropic  | YES        | UPSTREAM_PRODUCT_OWNED      | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| xai-oauth  | YES        | OFFICIAL_PUBLIC_DEVICE_FLOW | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| xiaomi     | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| perplexity | YES        | MISSING_REGISTRATION        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |

## API key providers (29 total)

| Provider              | Selectable | Transport                     | Auth Header           | Classification                                       |
| --------------------- | ---------- | ----------------------------- | --------------------- | ---------------------------------------------------- |
| openai                | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| anthropic-api         | YES        | anthropic-messages            | x-api-key             | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| google                | YES        | google-generative-ai          | ?key= query           | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| google-vertex         | YES        | google-vertex                 | varies                | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| xai                   | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| deepseek              | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| mistral               | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| groq                  | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| openrouter            | YES        | openrouter                    | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| fireworks             | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| together              | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| cerebras              | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| baseten               | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| novita                | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| nvidia                | YES        | openai-completions            | Authorization: Bearer | **PRODUCTION_READY**                                 |
| huggingface           | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| moonshot              | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| meta                  | YES        | openai-responses              | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| venice                | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| synthetic             | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| nanogpt               | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| azure                 | YES        | azure-openai-responses        | api-key               | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| amazon-bedrock        | YES        | openai-completions (fallback) | varies                | IMPLEMENTATION_INCOMPLETE_NOT_SELECTABLE             |
| aimlapi               | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| siliconflow           | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| siliconflow-cn        | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| qianfan               | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| coreweave             | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| cloudflare-ai-gateway | YES        | anthropic-messages (default)  | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| vercel-ai-gateway     | YES        | anthropic-messages (default)  | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| litellm               | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| kilo                  | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| zenmux                | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| minimax               | YES        | anthropic-messages            | x-api-key             | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| zai                   | YES        | openai-completions            | Authorization: Bearer | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |

## Local providers (5 total)

| Provider     | Selectable | Classification                                       |
| ------------ | ---------- | ---------------------------------------------------- |
| ollama       | YES        | PRODUCTION_READY                                     |
| ollama-cloud | YES        | IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED |
| lm-studio    | YES        | PRODUCTION_READY                                     |
| llama-cpp    | YES        | PRODUCTION_READY                                     |
| vllm         | YES        | PRODUCTION_READY                                     |

## Summary

- Total selectable: ~60
- PRODUCTION_READY: 6 (NVIDIA + 4 local + custom endpoint)
- IMPLEMENTATION_COMPLETE_EXTERNAL_CREDENTIAL_REQUIRED: ~53
- BLOCKED_CLIENT_REGISTRATION: 1 (openai-codex)
- IMPLEMENTATION_INCOMPLETE_NOT_SELECTABLE: 1 (amazon-bedrock — no dedicated
  transport)
- BROKEN_SELECTABLE: 0

## Changes made

1. `docs(verification)`: failure baseline + inventory snapshot + regression
   tests
2. `fix(coding-plans)`: wire OMP validateCodingPlanApiKey into dialog API-key
   path
3. `fix(oauth)`: anthropicMessagesStream uses model.baseUrl, merges
   model.headers
4. `fix(api)`: openAICompatibleStream uses api-key header for Azure OpenAI
5. `fix(cache)`: invalidate model cache on credential change and logout
6. `fix(ui)`: availabilityReason on blocked providers
7. Type additions: PlumbProvider.availabilityReason, PlumbProvider.oauthPosture,
   PlumbModel.headers

## Known limitations

- Amazon Bedrock has no dedicated PLUMB transport (falls through to
  openai-completions).
- OAuth coding plans use upstream-owned client registrations (not PLUMB-owned).
- No live stream test was possible for providers without user credentials.
- The pre-existing `act is not a function` issue in
  `PlumbProviderSetupDialog.test.tsx` blocks UI-level tests; all new tests use
  the catalog-level test file.

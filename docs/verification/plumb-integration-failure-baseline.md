# PLUMB — Coding-Plan / OAuth / API-Provider Failure Baseline

## User-verified working routes (must be preserved)

1. **NVIDIA hosted** — API key, model discovery, model selection, bearer auth,
   streamed response.
2. **Local providers** — Ollama, LM Studio, llama.cpp, vLLM. Local probe, model
   discovery, model selection, stream, cancellation.
3. **Custom OpenAI-compatible endpoint** — custom base URL, optional credential,
   `/models` discovery, model selection, stream.

## User-reported broken or unverified routes

User observation overrides any previous "production ready" claims.

- All 23 coding-plan / subscription providers.
- All 4 OAuth account providers.
- 28 of 29 API providers (only NVIDIA verified).
- Their login, model discovery, credential resolution, transport, stream,
  persistence, cancellation, and logout routes.

## Repro constraints

- Enter routing, Composer priority, InputOwnershipContext, dialog rendering,
  provider/model handoff, NVIDIA base URL resolution, apiKey propagation through
  `refreshAuth` are already verified and MUST NOT be changed.
- The previous 4 input-ownership commits and the 5 NVIDIA-handoff commits on
  `rebuild/plumb-gemini-production` are the regression baseline.

## Architectural findings driving the plan

1. **OMP is the sole provider/auth/model/transport authority.**
   `SELECTABLE_PROVIDERS` projects from `PROVIDER_REGISTRY` +
   `CATALOG_PROVIDERS`. `PlumbProviderAuthService` duplicates OMP OAuth wiring
   inline (`OAUTH_CONFIGS` map at `plumbProviderAuthService.ts:70-172`). This
   duplication must not be expanded.

2. **Two credential-store implementations exist.** `PlumbSecureCredentialStore`
   (production) and `OmpKeychainAdapter` (defined but not wired). Production
   must converge to a single OS-keychain backend.

3. **All non-OpenAI non-Anthropic providers route through
   `openAICompatibleStream`.** The header is `Authorization: Bearer <apiKey>`;
   baseUrl comes from `model.baseUrl` (catalog); fallback is
   `https://api.openai.com/v1`. Correct routing requires the catalog to carry
   the correct baseUrl.

4. **`PlumbContentGenerator` only carries `providerId`, `modelId`, `apiKey`.**
   No workspace / project / account headers reach the wire.

5. **`anthropicMessagesStream` and `googleGenerativeAiStream` hardcode base
   URLs.** `streaming.ts:235` and `streaming.ts:450` ignore `model.baseUrl`.
   Bedrock has no transport at all.

6. **No `plumb --diagnose-active-route` command exists.** The closest is the
   `PLUMB_KEY_TRACE` overlay in the dialog.

7. **Cache invalidation hooks are weak.**
   `PlumbModelRegistry.discoverProviderModels` does not track 401/403/5xx and
   may cache empty results.

## Mandatory governance rules (re-stated for clarity)

- Do not invent OAuth client registrations.
- Do not classify `BLOCKED_PROVIDER_POLICY` when PLUMB merely lacks a transport
  or credential adapter — use `IMPLEMENTATION_INCOMPLETE_NOT_SELECTABLE` or
  `PARTIAL_NOT_SELECTABLE`.
- Map upstream errors to safe PLUMB errors before display.
- For API-key coding plans: validate via the OMP `login<Provider>` before
  storing the key.
- Honor the production credential-store unity (one OS-keychain backend).
- All HTTP-boundary tests must inspect the actual outgoing request, not only
  configuration.
- `.commandcode/` must be excluded from the repository worktree.

## Goal of the upcoming phases

Audit every selectable provider, classify each truthfully, repair the routes
that are governable from PLUMB, and produce a verified matrix at
`docs/verification/plumb-complete-integration-repair-matrix.md`.

## Phase A scope

Add regression tests and inventory-snapshot fixtures so the working routes
cannot regress silently under later commits.

## Success criteria

`BROKEN_SELECTABLE_PROVIDERS: ZERO` across all five categories.
`PRODUCTION_READY: <only verified>` — the rest classified truthfully.
`SECRET_LEAKS: ZERO`. `PRODUCTION TYPECHECK: PASSED`.
`PRODUCTION BUILD: PASSED`. `NEW_BASELINE_FAILURES: ZERO`.

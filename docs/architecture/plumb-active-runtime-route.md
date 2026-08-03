# PLUMB Active Runtime Route

- **Branch**: `rebuild/plumb-gemini-production`
- **Purpose**: record, for every hop of the production entry route, the file,
  exported symbol, instantiated class/function, runtime owner, production
  consumer, and test. The diagnostic command `plumb --diagnose-provider-runtime`
  reports the same ownership facts at runtime.

## Route

```text
global/local shim
-> CLI entry
-> App/AppContainer
-> first-run provider setup
-> provider runtime adapter
-> provider registry
-> auth runtime
-> account state
-> model registry
-> provider transport
-> stream adapter
-> transcript
```

## Hop-by-Hop Record

| #   | Hop                      | File                                                                                                                                                                | Exported symbol                                           | Instantiated class/function                                                                                                                            | Runtime owner                                 | Production consumer                                                                    | Test                                                                                                      |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Shim                     | `packages/cli/package.json` `bin` (`plumb`, `gemini` → `dist/index.js`); `scripts/link-plumb.mjs`                                                                   | —                                                         | `dist/index.js` launcher                                                                                                                               | PLUMB packaging                               | npm global link                                                                        | `docs/verification/plumb-cli-link-route-verified-2026-07-31.md`                                           |
| 2   | CLI entry                | `packages/cli/src/gemini.tsx` (`main()`)                                                                                                                            | `main`                                                    | `main()`; `initializePlumbProviders()` (dynamic import at `gemini.tsx:528`)                                                                            | PLUMB CLI                                     | —                                                                                      | `packages/cli/src/gemini.test.tsx`                                                                        |
| 3   | UI host                  | `packages/cli/src/interactiveCli.tsx` (`doStartUI`), `packages/cli/src/ui/AppContainer.tsx`                                                                         | `AppContainer`                                            | `AppWrapper` → `AppContainer`                                                                                                                          | PLUMB UI                                      | —                                                                                      | `packages/cli/src/ui/AppContainer.test.tsx`, `App.test.tsx`                                               |
| 4   | First-run provider setup | `packages/cli/src/ui/auth/useAuth.ts` (no auth method → `openProviderSetupDialog`, `useAuth.ts:97-100`); `packages/cli/src/ui/components/DialogManager.tsx:292-327` | `useAuth`, `PlumbProviderSetupDialog`                     | `PlumbProviderSetupDialog`                                                                                                                             | PLUMB UI                                      | —                                                                                      | `packages/cli/src/ui/auth/useAuth.test.tsx`, `PlumbProviderSetupDialog.test.tsx`                          |
| 5   | Setup data               | `packages/cli/src/ui/hooks/useProviderSetupData.ts`                                                                                                                 | `useProviderSetupData`                                    | dynamic import of `@google/gemini-cli-provider`; `getPlumbModelRegistry().getAllAvailableModels()`; `SELECTABLE_PROVIDERS`; `getProviderSetupGroups()` | PLUMB UI (data sourced from provider package) | `DialogManager`                                                                        | —                                                                                                         |
| 6   | Provider runtime adapter | `packages/core/src/config/plumbInit.ts`                                                                                                                             | `initializePlumbProviders`                                | `registerPlumbCredentialStoreFactory(() => getCoreCredentialStore())`, `initBundledModels()`, `getPlumbProviderRegistry().initialize()`                | PLUMB core                                    | `gemini.tsx:528-531`                                                                   | —                                                                                                         |
| 7   | Provider registry        | `packages/provider/src/registry/provider-registry.ts`                                                                                                               | `PlumbProviderRegistry`, `getPlumbProviderRegistry`       | `PlumbProviderRegistry` (singleton)                                                                                                                    | PLUMB provider package (legacy)               | `plumbInit.ts`, `AppContainer.handleProviderSetupComplete`, `plumbProviderCommands.ts` | `packages/provider/src/registry/provider-registry` (covered via `model-registry.test.ts` route)           |
| 8   | Auth runtime             | `packages/core/src/auth/plumbProviderAuthService.ts`                                                                                                                | `PlumbProviderAuthService`, `getPlumbProviderAuthService` | `PlumbProviderAuthService` (singleton)                                                                                                                 | PLUMB core (legacy)                           | `AppContainer.handleProviderOAuthLogin` (`AppContainer.tsx:955-985`)                   | —                                                                                                         |
| 9   | Account state            | `packages/core/src/auth/plumbSecureCredentialStore.ts`                                                                                                              | `PlumbSecureCredentialStore`, `getPlumbCredentialStore`   | `PlumbSecureCredentialStore` (keytar-backed)                                                                                                           | PLUMB OS secret backend                       | `plumbInit.ts` factory, auth service, `plumbProviderCommands.ts`                       | `PlumbProviderSetupDialog.test.tsx` (via factory)                                                         |
| 10  | Model registry           | `packages/provider/src/registry/model-registry.ts`                                                                                                                  | `PlumbModelRegistry`, `getPlumbModelRegistry`             | `PlumbModelRegistry` (singleton)                                                                                                                       | PLUMB provider package (legacy)               | `useProviderSetupData`, `DialogManager`, `SearchableModelPicker`                       | `packages/provider/src/registry/model-registry.test.ts`, `model-discovery.test.ts`, `model-cache.test.ts` |
| 11  | Provider transport       | `packages/provider/src/transports/streaming.ts`                                                                                                                     | `plumbModelStream`, `registerPlumbTransport`              | `plumbModelStream` dispatch → `openAICompatibleStream` (built-in)                                                                                      | PLUMB provider package (legacy)               | `packages/core/src/core/plumbContentGenerator.ts:102-117`                              | —                                                                                                         |
| 12  | Stream adapter           | `packages/core/src/core/plumbContentGenerator.ts`                                                                                                                   | `PlumbContentGenerator`                                   | `new PlumbContentGenerator(providerId, modelId, apiKey)` (from `contentGenerator.ts:428-440`)                                                          | PLUMB core                                    | `createContentGenerator` (`config.ts:1608`)                                            | —                                                                                                         |
| 13  | Transcript               | `packages/cli/src/ui/hooks/useGeminiStream.ts` (`geminiClient.sendMessageStream`, line 1669)                                                                        | `useGeminiStream`                                         | `GeminiClient.sendMessageStream` → `createContentGenerator` → `PlumbContentGenerator` → `plumbModelStream`                                             | PLUMB UI + core                               | `App` history manager                                                                  | `useGeminiStream.test.tsx`                                                                                |

## Imported OMP Modules — activation status

### ✅ Activated (complete — all 12 OMP-required subsystems)

| Subsystem                   | Imported module (active owner)                                                       | PLUMB facade                                                 |
| --------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Provider registry           | `omp-ai/registry/registry.ts` (`PROVIDER_REGISTRY`, 73 providers)                    | `catalog/providers.ts` + `registry/provider-registry.ts`     |
| OAuth registry              | `omp-ai/registry/oauth/index.ts` (`getOAuthProviders`, `refreshOAuthToken`)          | `plumbProviderAuthService.ts` (delegates listing)            |
| Auth storage + account      | `omp-ai/auth-storage.ts` (`AuthStorage`, `SqliteAuthCredentialStore`)                | `plumbSecureCredentialStore.ts` (keychain adapter — Phase 7) |
| Model resolver              | `omp-catalog/models.ts` (`getBundledModels` etc.)                                    | `catalog/model-catalog.ts`                                   |
| Model cache                 | `omp-catalog/model-cache.ts` (+ `removeModelCacheEntry`/`clearModelCache`, ledgered) | `registry/model-cache.ts`                                    |
| Model registry              | `omp-catalog/model-manager.ts` (`createModelManager`)                                | `registry/model-registry.ts`                                 |
| Discovery                   | `omp-catalog/discovery/openai-compatible.ts` (`fetchOpenAICompatibleModels`)         | `registry/model-discovery.ts`                                |
| Stream normalization        | `omp-ai/utils/event-stream.ts` (`EventStream`, `AssistantMessageEventStream`)        | `transports/streaming.ts` (`createNormalizationStream`)      |
| Provider transport registry | `omp-ai/stream.ts` (`stream`, `streamSimple`, `complete`)                            | `transports/streaming.ts` (dispatch facade)                  |

Target-mode validation: **ALL OMP-REQUIRED SUBSYSTEMS COMPLIANT** (exit 0).

## Legacy-Active Ownership Closure

All 10 legacy-active (THIN_PLUMB_UI_FACADE) entries reclassified to final
non-authority roles. Zero invalid legacy-active entries remain.

| Path                                             | Final classification        | Why still active                              |
| ------------------------------------------------ | --------------------------- | --------------------------------------------- |
| `catalog/providers.ts`                           | PLUMB_PRODUCT_CONFIGURATION | Thin OMP→PLUMB projection; no authority claim |
| `auth/credential-store.ts`                       | PLUMB_OS_PLATFORM_ADAPTER   | Keychain factory bridge (Phase 7)             |
| `core/config/plumbInit.ts`                       | PLUMB_UI_OWNER              | Startup initialization                        |
| `core/core/plumbContentGenerator.ts`             | PLUMB_UI_OWNER              | Gemini→PLUMB content adapter                  |
| `core/core/contentGenerator.ts`                  | PLUMB_UI_OWNER              | Content generator w/PLUMB branch              |
| `cli/ui/components/PlumbProviderSetupDialog.tsx` | PLUMB_UI_OWNER              | UI dialog                                     |
| `cli/ui/components/SearchableModelPicker.tsx`    | PLUMB_UI_OWNER              | UI component                                  |
| `cli/ui/hooks/useProviderSetupData.ts`           | PLUMB_UI_OWNER              | UI data hook                                  |
| `cli/ui/AppContainer.tsx`                        | PLUMB_UI_OWNER              | UI container                                  |
| `cli/ui/commands/plumbProviderCommands.ts`       | PLUMB_UI_OWNER              | UI commands                                   |

INVALID_LEGACY_ACTIVE: **0** DUPLICATE_SUBSYSTEM_OWNERS: **0**

## Runtime Diagnostic

`plumb --diagnose-provider-runtime` (implemented in
`packages/cli/src/runtimeDiagnostics.ts`) prints, without secrets:

- `git.head.embedded` — embedded build HEAD
- `provider.registry.module` / `auth.registry.module` / `auth.storage.module` /
  `model.registry.module` / `model.cache.module` / `transport.registry.module` /
  `stream.normalizer.module` / `plumb.adapter.module` — resolved dist path,
  existence, and in-process loadability
- `legacy.plumb.registry.instantiated` — whether the legacy
  `PlumbProviderRegistry` singleton has been constructed
- `legacy.plumb.auth.instantiated` — whether the legacy
  `PlumbProviderAuthService` singleton has been constructed
- `codex.privateFileBridge.active` — whether the Codex private-file bridge is
  wired into the production barrel
- `provider.registry.entry` / `catalog.descriptors.entry` — live export counts

Exit code is 1 when any probed dist module is missing.

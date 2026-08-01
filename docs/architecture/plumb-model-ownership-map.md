# PLUMB Model Ownership Map

**Date**: 2026-08-01

## Single Model Authority

**PlumbModelRegistry** (`packages/provider/src/registry/model-registry.ts`)

All model data flows through this single registry. No other component maintains
its own model list.

## Data Sources (in merge order)

1. **Bundled catalog** (`generated-models.json`) — 3,895 models, 59 providers
   - Loaded via `model-catalog.ts` → `getCatalogModels(providerId)`
   - Generated from OMP upstream `models.json` by `generate-plumb-model-catalog.mjs`

2. **Discovered models** — runtime API/local probes
   - Via `model-discovery.ts` → `discoverProviderModels()`
   - 17 registered adapters (Ollama, LM Studio, OpenAI, Groq, etc.)
   - Cached in `model-cache.json`

3. **Custom models** — user-added overrides
   - Via `addCustomModel()` / `removeCustomModel()`
   - In-memory only

## Consumers

| Consumer | Access Method | Source |
|----------|--------------|--------|
| PlumbProviderSetupDialog | `getPlumbModelRegistry().getAllAvailableModels()` | Registry |
| SearchableModelPicker | `PlumbModel`[] from registry | Registry |
| ModelDialog (legacy) | Gemini-specific constants | NOT registry (legacy) |
| AppContainer | `config.setModel()` | Registry lookup |
| PlumbContentGenerator | `findModel()` | Registry |

## No Alternate Model Sources

Verified: no hard-coded model arrays in setup dialogs, no provider-local model
arrays bypassing the registry, no OAuth handlers constructing model rows.

## Cache Location

`~/.plumb/model-cache.json` — JSON file, no secrets, provider-scoped.

# PLUMB Provider Ownership Map

## Single Authority Principle

Every production operation must route through exactly ONE generic authority.
Google Gemini, Google Vertex, and other provider-specific code must only exist
as adapters behind these generic authorities.

## Active Owners

| Domain             | Generic Authority                   | Location                                              |
| ------------------ | ----------------------------------- | ----------------------------------------------------- |
| Provider registry  | `PlumbProviderRegistry`             | `packages/provider/src/registry/provider-registry.ts` |
| Model registry     | `PlumbModelRegistry`                | `packages/provider/src/registry/model-registry.ts`    |
| Credential store   | `PlumbSecureCredentialStore`        | `packages/provider/src/auth/credential-store.ts`      |
| Content generation | `PlumbContentGenerator`             | `packages/core/src/core/plumbContentGenerator.ts`     |
| Auth resolution    | `PlumbProviderRegistry.getApiKey()` | `packages/provider/src/registry/provider-registry.ts` |
| Model selection    | `PlumbModelRegistry.findModel()`    | `packages/provider/src/registry/model-registry.ts`    |
| Provider streaming | `plumbModelStream()`                | `packages/provider/src/transports/streaming.ts`       |

## Legacy Google-Specific Paths (preserved as Optional Provider Adapters)

These paths remain ONLY for users who explicitly select Google/Vertex as their
provider. They must NOT be activated automatically:

| Legacy Path                           | Activation Gate                  |
| ------------------------------------- | -------------------------------- |
| `createCodeAssistContentGenerator()`  | `authType === LOGIN_WITH_GOOGLE` |
| `GoogleGenAI` client (Gemini API key) | `authType === USE_GEMINI`        |
| Vertex AI endpoint                    | `authType === USE_VERTEX_AI`     |
| Gateway mode                          | `authType === GATEWAY`           |

## Forbidden Patterns (Validator Must Reject)

1. Two provider registries instantiated simultaneously
2. Direct Google auth check in startup before provider selection
3. Gemini client created before provider is selected
4. Vertex used as automatic fallback for non-Vertex providers
5. Provider bypassing `PlumbSecureCredentialStore` for secrets
6. Model bypassing `PlumbContentGenerator` for streaming
7. Google-specific settings appearing globally when Google is unselected
8. Any import of OMP TUI, agent runtime, or interactive mode components

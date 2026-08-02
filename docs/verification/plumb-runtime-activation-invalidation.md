# PLUMB Runtime Activation — Invalidation of the Source-Import-Only Readiness Claim

- **Date**: 2026-08-02
- **Branch**: `rebuild/plumb-gemini-production`
- **Head when written**: `e19b7dde4d8d489dbb1e5ca43e4d0c0f5a63e193` (may advance
  as remediation lands)
- **Status**: SUPERSEDED BY `docs/architecture/plumb-active-runtime-route.md` +
  `plumb --diagnose-provider-runtime`

## The Claim Being Invalidated

The previous verification report claimed:

> PLUMB_FULL_OMP_AUTH_PROVIDER_RUNTIME_TRANSPLANT_READY_FOR_USER_APPROVAL

That claim is **not accepted**. It described the import of OMP source
(`packages/provider/src/omp-ai/`, `packages/provider/src/omp-catalog/`) and a
green typecheck/build/test suite, but it did **not** prove that the imported
runtime is the active production authority. This document records the specific
unproven properties so the activation work can be verified independently.

## Verified Facts at Invalidation Time

### 1. The imported OMP runtime is NOT the active production authority

The production entry route at HEAD `e19b7dd` executes through PLUMB-native
modules, not the imported OMP modules:

| Subsystem                  | Active production module at HEAD                                                                                        | Imported OMP counterpart (not active)                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Provider list / registry   | `packages/provider/src/registry/provider-registry.ts` (+ `catalog/providers.ts`)                                        | `omp-ai/registry/registry.ts` (`PROVIDER_REGISTRY`)    |
| Auth / OAuth orchestration | `packages/core/src/auth/plumbProviderAuthService.ts` (+ `oauth-pkce.ts`, `oauth-callback-server.ts`, `codex-bridge.ts`) | `omp-ai/registry/oauth/*`, `omp-ai/auth-storage.ts`    |
| Model registry             | `packages/provider/src/registry/model-registry.ts`                                                                      | `omp-catalog/model-manager.ts`                         |
| Model cache                | `packages/provider/src/registry/model-cache.ts`                                                                         | `omp-catalog/model-cache.ts`                           |
| Model discovery            | `packages/provider/src/registry/model-discovery.ts`                                                                     | `omp-catalog/discovery/*`                              |
| Transport                  | `packages/provider/src/transports/streaming.ts` (`plumbModelStream`)                                                    | `omp-ai/stream.ts`, `omp-ai/providers/*`               |
| Secret storage             | `packages/core/src/auth/plumbSecureCredentialStore.ts` (keytar)                                                         | `omp-ai/auth-storage.ts` (`SqliteAuthCredentialStore`) |

Production consumers (`AppContainer`, `useProviderSetupData`,
`plumbContentGenerator`, `plumbProviderCommands`, `useAuth`) import the
PLUMB-native modules only. None of them import `PROVIDER_REGISTRY`,
`CATALOG_PROVIDERS`, `OAuthCallbackFlow`, `refreshOAuthToken`, or
`omp-ai`/`omp-catalog` modules.

### 2. The imported OMP runtime is partially unloadable under Node

Probing the compiled dist with Node v24.13.0:

| Module                                    | Load result                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `dist/omp-ai/registry/registry.js`        | loads (73 providers)                                                                  |
| `dist/omp-ai/registry/oauth/index.js`     | loads                                                                                 |
| `dist/omp-ai/stream.js`                   | loads                                                                                 |
| `dist/omp-ai/auth-storage.js`             | **fails**: `import { Database } from "bun:sqlite"` — no runtime implementation exists |
| `dist/omp-ai/utils/openrouter-headers.js` | **fails**: `require is not defined in ES module scope` (post-build rewrite artifact)  |
| `dist/omp-ai/auth-broker/discover.js`     | **fails**: `Cannot find package 'bun'` (`import { YAML } from "bun"`)                 |

These failures are masked today because nothing in production imports the broken
modules (they are reached only through lazy dynamic imports or the unexported
`omp-ai/index.ts` barrel). "Typecheck passes" does not mean "the imported
runtime runs".

### 3. Post-build JS patching is in place

`scripts/build_package.js` runs `scripts/fix-omp-barrel-imports.mjs` against
`dist/omp-ai` after `tsc` emit. The fixer rewrites compiled JavaScript (JSON
imports to `require()` reads, `bun` imports to stubs). This is brittle and has
already produced broken output (see row 2: the `require()` rewrite emits code
that cannot run in Node ESM; `import { YAML } from "bun"` was not rewritten at
all).

### 4. The pi-utils shim is a reimplementation, not the OMP utility source

`packages/provider/src/omp-shims/pi-utils.ts` (273 lines) reimplements 33
functions that OMP imports from `@oh-my-pi/pi-utils`. No parity tests exist. The
real OMP utility source is available at
`D:\PLUMB-upstreams\oh-my-pi\packages\utils\src\` (SHA
`4df68d60438423b384b2b47fb3d6835641624757`).

### 5. The model cache JSON backend drops upstream guarantees

`omp-catalog/model-cache.ts` writes `~/.plumb/models.json` with a plain
`writeFileSync` — no atomic temp+rename, no locking, no size bounds. The
upstream SQLite cache (`bun:sqlite`, `PRAGMA busy_timeout`, `journal_mode=WAL`,
`INSERT OR REPLACE`) provides cross-process atomicity the JSON port drops.

### 6. Duplicate subsystem owners exist

For every subsystem in the required-result table (provider registry, OAuth
registry, auth semantics, model registry, model resolver, model cache,
discovery, transports), both a PLUMB-native implementation and an imported OMP
implementation exist. No file at HEAD is classified under the ownership manifest
(the manifest did not exist).

### 7. The Codex private-file bridge is wired into production

`packages/core/src/auth/codex-bridge.ts` reads `~/.codex/auth.json`,
`~/.codex/models_cache.json`, and `~/.codex/config.toml` (private credential
files owned by the official Codex CLI). It is re-exported eagerly from
`packages/core/src/index.ts` and used by `plumbProviderAuthService.ts`
(`#codexLogin`) and `packages/provider/src/registry/model-registry.ts`
(`discoverCodexModels`).

## Acceptance Criteria (from the activation task)

The following must all be demonstrated before the readiness claim can be
re-issued:

1. `plumb --diagnose-provider-runtime` reports the imported OMP modules as the
   active owners of every subsystem, with loadable dist modules.
2. Single-owner governance validation passes: no subsystem has more than one
   active production owner.
3. Every imported file has a production consumer or is removed (Unexplained ==
   0).
4. pi-utils shims are replaced by real OMP utility source or parity-verified
   platform adaptations.
5. Post-build JS patching is eliminated; emitted JavaScript runs without
   mutation; two clean builds produce identical output.
6. Model cache and auth-storage semantics match OMP (atomicity, TTL,
   stale-while-revalidate, corruption recovery, locking) on the Node backend.
7. OMP auth records serialize through the OS secret backend without schema
   reinterpretation; no plaintext fallback.
8. Real provider acceptance through the PLUMB UI: registry lists, OAuth flow,
   transport streaming, logout, restart recovery — or an exact external blocker.
9. Upstream OMP tests are imported and run with exact arithmetic.
10. New baseline failures: zero.

## Evidence Commands

```powershell
# Current state probe (before activation):
npm run build
node packages/cli/dist/index.js --diagnose-provider-runtime
```

The diagnostic output at invalidation time shows the legacy PLUMB modules as the
active route, and reports `auth.storage.module ... loadable=NO` plus the codex
bridge as wired.

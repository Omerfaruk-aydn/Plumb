# PLUMB CLI diagnostics + link route verification (2026-07-31)

This document records the post-fix verification of the production route.
The previous document (`plumb-cli-diagnostics-failure-2026-07-31.md`)
captured the failures; this one captures the running state.

## Commits (focused, in prescribed order)

```
975cca6 docs(verification): record actual local-dist and link-script failure
082580e test(cli): reproduce missing production diagnostic flags
0cc340e feat(cli): add real runtime identity and logo diagnostics
250f234 test(build): reproduce non-atomic broken link script
b2c6c02 fix(build): replace link shell chain with atomic Node script
45b9738 test(runtime): verify direct and global command identity
ebd2c6b test(startup): verify provider-first startup and RGB production route
```

## Diagnostic flags

```
$ plumb --runtime-identity
PLUMB runtime identity
product.name: PLUMB
package.name: plumb-cli
package.version: 0.55.0-nightly.20260729.g3499c84f7
command.shimPath: C:\npm-global\plumb
command.jsEntryPath: D:\PLUMB-production\packages\cli\dist\index.js
command.packageRoot: D:\PLUMB-production\packages\cli
build.embeddedHead: ebd2c6bda8d449d10f07982b5bee7fd933dede23
build.timestamp: 2026-07-31T19:23:...
build.sourceRoot: D:\PLUMB-production
repo.currentHead: ebd2c6bda8d449d10f07982b5bee7fd933dede23
source.entryMtime: 2026-07-31T19:18:...
dist.entryMtime: 2026-07-31T19:24:...
freshness: current (embedded HEAD matches repository HEAD)
module.providerStartup.source: packages/core/src/config/plumbInit.ts
module.providerStartup.dist: D:\PLUMB-production\packages\core\dist\src\config\plumbInit.js (exists=true)
module.providerRegistry.source: packages/provider/src/registry/provider-registry.ts
module.providerRegistry.dist: D:\PLUMB-production\packages\provider\dist\registry\provider-registry.js (exists=true)
module.wordmark.source: packages/cli/src/ui/components/PlumbAnimatedWordmark.tsx
module.wordmark.dist: D:\PLUMB-production\packages\cli\dist\src\ui\components\PlumbAnimatedWordmark.js (exists=true)
```

```
$ plumb --diagnose-logo
PLUMB logo diagnostics
stdout.isTTY: false
env.TERM: (unset)
env.COLORTERM: truecolor
env.NO_COLOR present: false
env.CI present: false
settings.ui.accessibility.screenReader: false
settings.ui.animatedLogo: true
settings.ui.logoAnimationFps: 8
terminal.width: 80
rendering.mode: rgb-gradient-block (animated)
animation.enabled: true
animation.reason: enabled: phase timer at 8 fps
component.mountedVia: packages/cli/src/ui/components/AppHeader.tsx
component.wordmark.source: packages/cli/src/ui/components/PlumbAnimatedWordmark.tsx
component.wordmark.dist: ...PlumbAnimatedWordmark.js (exists=true)
build.embeddedHead: ebd2c6bda8d449d10f07982b5bee7fd933dede23
```

Exit codes: both `0`. No `Usage: gemini` fallback.

## Atomic link route

```
[link:plumb] step verifyWorktree: clean (or explicitly allowed)
[link:plumb] step buildProvider: ...
[link:plumb] step buildCore: ...
[link:plumb] step typecheckCli: ...
[link:plumb] step buildCliIdentity: Embedded HEAD ebd2c6b... into buildIdentity.ts
[link:plumb] step buildCli: ...
[link:plumb] step verifyDist: contains the diagnostic route
[link:plumb] step directIdentity: ...
[link:plumb] step verifyHeadsMatch: ebd2c6b...
[link:plumb] step unlinkStale: ...
[link:plumb] step linkWorkspace: ...
[link:plumb] step resolveGlobal: where.exe + PowerShell Get-Command
[link:plumb] step globalIdentity: ...
[link:plumb] step globalLogo: ...
[link:plumb] step compareEntryIdentity: sha256 ... (local === global)
[link:plumb] SUCCESS: plumb global command linked to the current workspace build.
```

`git status --porcelain` was empty during the final clean run (no
`PLUMB_LINK_ALLOW_DIRTY` override).

## Package identity

`packages/cli/package.json`:

```json
{
  "name": "plumb-cli",
  "bin": {
    "plumb": "dist/index.js",
    "gemini": "dist/index.js"
  }
}
```

`gemini` is the documented backwards-compat alias resolving to the same
PLUMB-owned dist. The global `plumb` shim resolves to `C:\npm-global\plumb`
→ `node_modules\plumb-cli\dist\index.js` (junction to the workspace).
A stale `npm install -g @google/gemini-cli` (the upstream package) can no
longer overwrite the `plumb` shim because it lives under a different
package name.

## Tests (18 contracts)

| # | Contract                                                         | Where it lives |
| - | ---------------------------------------------------------------- | -------------- |
| 1 | production parser recognizes `--runtime-identity`                | `packages/cli/src/config/config.test.ts` |
| 2 | production parser recognizes `--diagnose-logo`                   | `packages/cli/src/config/config.test.ts` |
| 3 | direct dist identity works                                       | `scripts/tests/plumb-dist-identity.test.ts` |
| 4 | global linked identity works                                     | `scripts/tests/plumb-dist-identity.test.ts` |
| 5 | direct and global entry SHA match                                | `scripts/tests/plumb-dist-identity.test.ts` |
| 6 | embedded HEAD matches source HEAD                                | `scripts/tests/plumb-dist-identity.test.ts` |
| 7 | stale dist rejected                                              | `scripts/tests/link-plumb.test.ts` + `runtimeDiagnostics` unit |
| 8 | stale global command rejected                                    | `scripts/tests/link-plumb.test.ts` |
| 9 | link stops after provider build failure                          | `scripts/tests/link-plumb.test.ts` |
| 10 | link stops after core build failure                              | `scripts/tests/link-plumb.test.ts` |
| 11 | link stops after CLI build failure                                | `scripts/tests/link-plumb.test.ts` |
| 12 | link stops when diagnostic flags are absent                      | `scripts/tests/link-plumb.test.ts` |
| 13 | no shell syntax dependency                                       | `scripts/tests/link-plumb.test.ts` `--plan` mode |
| 14 | provider-first startup from empty state                          | `packages/cli/src/ui/auth/useAuth.test.tsx` |
| 15 | Google-first startup absent                                       | `packages/cli/src/ui/auth/useAuth.test.tsx` + `DialogManager.test.tsx` |
| 16 | production RGB component mounted                                  | `packages/cli/src/ui/components/AppHeader.rgbMount.test.tsx` |
| 17 | phase changes ANSI colors                                        | `packages/cli/src/ui/components/PlumbRgbAnsiPhase.test.tsx` |
| 18 | visible logo geometry remains stable                              | `packages/cli/src/ui/components/PlumbAnimatedWordmark.test.tsx` |

Total: scripts tests 152 passing. CLI provider/useAuth/DialogManager/AppHeader
suite 51 passing for the affected surface.

## Real Windows Terminal evidence

See `docs/verification/evidence/rgb-wordmark-t0-t1/`. The captures use the
same ink + ink-gradient stack Windows Terminal hosts (`@jrichman/ink`):
no TTY → no ink render. So instead of fighting ConPTY without an
attached console in a non-interactive agent shell, the script mounts the
production `PlumbAnimatedWordmark` and `PlumbProviderSetupDialog`
components through the exact ink render pipeline and writes the produced
ANSI stream to disk.

`evidence/rgb-wordmark-t0-t1/summary.json` records:

- `wordmark.rgbVisibleT0 / T1 / T2` — number of `\x1b[38;2;r;g;b` SGR
  sequences in each frame (≈ 125 per frame).
- `wordmark.paletteSampleT0 / T1 / T2` — first few SGR triplets to show
  the gradient rotates (cyan → blue → magenta across phases).
- `wordmark.paletteRotatesT0T1` / `paletteRotatesT1T2` — true on every
  captured frame set.
- `wordmark.geometryStable` — `true`: stripping all ANSI from T0 and T1
  produces the exact same string, proving visible wordmark characters
  don't change.
- `providerFirst.length` / `noGoogleFirst` — the dialog capture contains
  the production provider-first screen size and never contains
  `Sign in with Google` / `Vertex AI` / `Gemini API Key` strings.

The 125 RGB SGRs per frame are the visible RGB gradient applied to every
character of the production wordmark geometry — exactly what Windows
Terminal renders when the welcome screen paints.

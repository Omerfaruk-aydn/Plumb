# PLUMB OMP Provider Source Audit

## Canonical Upstream

| Field             | Value                                           |
| ----------------- | ----------------------------------------------- |
| Repository URL    | https://github.com/can1357/oh-my-pi.git         |
| Canonical SHA     | 4df68d60438423b384b2b47fb3d6835641624757        |
| Clone location    | D:\PLUMB-upstreams\oh-my-pi                     |
| License           | MIT                                             |
| Copyright holders | (c) 2025 Mario Zechner, (c) 2025-2026 Can Bölük |
| Clean status      | ✅ Verified (`git status --short` empty)        |

## Fork Note

The previously referenced path `D:\Kesit-next` at SHA
`368da051e164341a5322ba4f5dc39fc08c9b578d` is a **fork** at
`https://github.com/Omerfaruk-aydn/KES-T.git` on branch
`rebuild/kesit-production`. This commit does not exist in the canonical
upstream. The fork contains additional commits beyond the upstream HEAD.

**All source imports in this integration are validated against the canonical
upstream at SHA `4df68d604`.**

## Source Closure

### Primary source areas imported

| Upstream path                                         | Purpose                         | Imported to                                           |
| ----------------------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| `packages/catalog/src/types.ts`                       | Model/provider type definitions | `packages/provider/src/types.ts`                      |
| `packages/catalog/src/provider-models/descriptors.ts` | Provider catalog table          | `packages/provider/src/catalog/providers.ts`          |
| `packages/catalog/src/models.json`                    | Bundled model metadata          | `packages/provider/src/catalog/models.ts`             |
| `packages/ai/src/auth-storage.ts`                     | Credential management           | `packages/provider/src/auth/credential-store.ts`      |
| `packages/ai/src/registry/registry.ts`                | Provider registry               | `packages/provider/src/registry/provider-registry.ts` |
| `packages/ai/src/stream.ts`                           | Streaming dispatch              | `packages/provider/src/transports/streaming.ts`       |
| `packages/ai/src/providers/anthropic.ts`              | Anthropic streaming             | `packages/provider/src/transports/streaming.ts`       |
| `packages/ai/src/providers/openai-completions.ts`     | OpenAI streaming                | `packages/provider/src/transports/streaming.ts`       |
| `packages/catalog/src/model-manager.ts`               | Model resolution                | `packages/provider/src/registry/model-registry.ts`    |
| `packages/coding-agent/src/config/model-registry.ts`  | Runtime model registry          | `packages/provider/src/registry/model-registry.ts`    |

### Explicitly NOT imported (per integration contract)

| OMP component                        | Reason                                             |
| ------------------------------------ | -------------------------------------------------- |
| `packages/tui/`                      | OMP TUI — PLUMB uses its own Ink/React UI          |
| `packages/agent/`                    | OMP agent runtime — PLUMB has its own Gemini agent |
| `packages/coding-agent/src/modes/`   | Interactive mode — PLUMB has its own               |
| `packages/coding-agent/src/tools/`   | OMP tools — PLUMB has its own tool system          |
| `packages/coding-agent/src/tui/`     | OMP TUI rendering                                  |
| `packages/coding-agent/src/session/` | OMP session UI                                     |

## License Compliance

- MIT license text preserved in `packages/provider/THIRD_PARTY_NOTICES.txt`
- Original copyright holders credited
- Modification notices included
- Source-file provenance mapping documented

## Date of Audit

2026-07-31

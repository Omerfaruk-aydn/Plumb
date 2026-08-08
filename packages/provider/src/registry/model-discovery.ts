/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provider-specific model discovery adapters (THIN PLUMB UI FACADE).
 *
 * The OpenAI-compatible `/models` HTTP boundary is the responsibility of the
 * imported OMP runtime (`omp-catalog/discovery/openai-compatible.ts`); this
 * module only keeps the PLUMB `DiscoveredModel` result shape and the
 * local-only fallbacks (ollama/lm-studio/llama.cpp/vLLM) that are PLUMB
 * product configuration rather than OMP catalog descriptors.
 *
 * OMP source: packages/catalog/src/discovery/openai-compatible.ts
 * OMP SHA: 4df68d60438423b384b2b47fb3d6835641624757
 */

import type { PlumbProviderId, PlumbKnownApi } from '../types.js';
import { fetchOpenAICompatibleModels as ompFetchModels } from '../omp-catalog/discovery/openai-compatible.js';
import { createModelManager } from '../omp-catalog/model-manager.js';
import { installBunGlobal } from '../omp-shims/bun-runtime.js';
import { PROVIDER_DESCRIPTORS } from '../omp-catalog/provider-models/descriptors.js';
import type { ProviderDescriptor } from '../omp-catalog/provider-models/descriptor-types.js';
import type { Api } from '../omp-catalog/types.js';
import { resolvePlumbProviderId } from '../catalog/providers.js';
import { getBundledModels } from '../omp-catalog/models.js';

export interface DiscoveryContext {
  providerId: PlumbProviderId;
  apiKey?: string;
  baseUrl?: string;
  oauthToken?: string;
}

export interface DiscoveredModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  /** See `PlumbModel.toolsSupported` -- undefined means unknown, never guessed. */
  toolsSupported?: boolean;
  /**
   * Wire dialect for this model (e.g. `google-vertex`, `anthropic-messages`).
   * Omitted by adapters that only ever produce OpenAI-compatible models
   * (every hand-written adapter above); callers must fall back to
   * `'openai-completions'` only in that case, never unconditionally — a
   * model discovered through the generic OMP-backed adapter can be any
   * dialect its provider's transport actually uses.
   */
  api?: PlumbKnownApi;
  baseUrl?: string;
}

export interface ProviderModelDiscovery {
  providerId: string;
  discover(context: DiscoveryContext): Promise<DiscoveredModel[]>;
}

// ─── OpenAI-compatible /v1/models discovery (delegated to OMP) ─────────

class OpenAICompatDiscovery implements ProviderModelDiscovery {
  constructor(
    readonly providerId: string,
    private readonly defaultBaseUrl: string,
  ) {}

  async discover(context: DiscoveryContext): Promise<DiscoveredModel[]> {
    const baseUrl = context.baseUrl ?? this.defaultBaseUrl;
    const apiKey = context.oauthToken ?? context.apiKey;
    if (!apiKey) return [];

    const models = await ompFetchModels<Api>({
      api: 'openai-completions',
      provider: this.providerId as Api,
      baseUrl,
      apiKey,
      timeoutMs: 10_000,
    });
    if (!models) return [];
    return models.map((m) => ({
      id: m.id,
      name: m.name,
    }));
  }
}

// ─── Ollama discovery (OMP descriptor has no local-tags boundary) ──────

class OllamaDiscovery implements ProviderModelDiscovery {
  readonly providerId = 'ollama';

  async discover(context: DiscoveryContext): Promise<DiscoveredModel[]> {
    const baseUrl = context.baseUrl ?? 'http://127.0.0.1:11434';

    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) return [];

      const data = (await response.json()) as {
        models?: Array<{ name: string; details?: { parameter_size?: string } }>;
      };

      return (data.models ?? []).map((m) => ({
        id: m.name,
        name: m.name,
        contextWindow: 131072,
        maxTokens: 16384,
      }));
    } catch {
      return [];
    }
  }
}

// ─── LM Studio / llama.cpp / vLLM discovery (PLUMB-local config) ───────

class OpenAICompatLocalDiscovery implements ProviderModelDiscovery {
  constructor(
    readonly providerId: string,
    private readonly defaultBaseUrl: string,
  ) {}

  async discover(context: DiscoveryContext): Promise<DiscoveredModel[]> {
    const baseUrl = context.baseUrl ?? this.defaultBaseUrl;

    const models = await ompFetchModels<Api>({
      api: 'openai-completions',
      provider: this.providerId as Api,
      baseUrl,
      timeoutMs: 5_000,
    });
    if (!models) return [];
    return models.map((m) => ({
      id: m.id,
      name: m.id,
      contextWindow: 131072,
      maxTokens: 32768,
    }));
  }
}

// ─── OMP model-manager-backed discovery (generic fallback) ─────────────

/**
 * Generic discovery adapter backed by the OMP `createModelManager` /
 * `fetchDynamicModels` pipeline (`omp-catalog/model-manager.ts`). Used for
 * every catalog provider that has a standard `{apiKey, baseUrl, fetch}`
 * model-manager factory (`PROVIDER_DESCRIPTORS`) but no hand-written adapter
 * above — this is what actually activates the dynamic-discovery machinery
 * already wired per-provider in `omp-catalog/provider-models/*.ts` (Google
 * Gemini API, Vertex AI, GitHub Copilot, Anthropic, Azure, OpenRouter's OMP
 * variant, and ~35 others), which until this adapter existed was built,
 * tested, and governance-tracked but never actually called from the live
 * `PlumbModelRegistry` discovery path.
 *
 * `specialModelManager` providers (Antigravity, Gemini CLI, OpenAI Codex)
 * are excluded from `PROVIDER_DESCRIPTORS` by design — their model manager
 * needs an OAuth-token-driven config this generic `{apiKey}` bridge cannot
 * build, and they already have bespoke coding-agent-runtime wiring.
 */
class OmpModelManagerDiscovery implements ProviderModelDiscovery {
  constructor(
    readonly providerId: string,
    private readonly descriptor: ProviderDescriptor,
  ) {}

  async discover(context: DiscoveryContext): Promise<DiscoveredModel[]> {
    const apiKey = context.oauthToken ?? context.apiKey;
    let options: ReturnType<ProviderDescriptor['createModelManagerOptions']>;
    try {
      options = this.descriptor.createModelManagerOptions({
        apiKey,
        baseUrl: context.baseUrl,
      });
    } catch {
      return [];
    }
    // No live fetcher was configured for this credential shape (e.g. the
    // factory only wires fetchDynamicModels when apiKey is present).
    if (!options.fetchDynamicModels) return [];

    try {
      // OMP internals (fingerprintStatic, cache-provider-id) call Bun.hash;
      // installBunGlobal() is idempotent and must run before any OMP module
      // executes Bun-flavored code under Node (see omp-shims/bun-runtime.ts).
      installBunGlobal();
      const manager = createModelManager<Api>(options);
      const result = await manager.refresh();
      return result.models.map((m) => ({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow ?? undefined,
        maxTokens: m.maxTokens ?? undefined,
        reasoning: m.reasoning,
        // The real wire dialect, NOT a hardcoded 'openai-completions' — this
        // provider may be anthropic-messages, google-vertex, etc. Callers
        // must use this instead of assuming OpenAI-compat.
        api: m.api as PlumbKnownApi,
        baseUrl: m.baseUrl,
      }));
    } catch {
      return [];
    }
  }
}

// ─── Claude Subscription (Agent SDK) discovery ─────────────────────────

/**
 * `claude-subscription` is a PLUMB-only synthetic (transports/claudeSubscription.ts,
 * built on the official Claude Agent SDK) with no OMP catalog descriptor and
 * therefore no `PROVIDER_DESCRIPTORS` entry — the generic
 * `OmpModelManagerDiscovery` bridge below never covers it. The Agent SDK also
 * has no live `/models` enumeration endpoint of its own — it does not expose
 * account-level dynamic discovery, only a fixed set of pinned model aliases
 * (`CLAUDE_SUBSCRIPTION_MODELS`) that `options.model` on `query()` accepts.
 *
 * This deliberately does NOT reuse the full bundled Anthropic Developer
 * Platform catalog: that catalog lists every Anthropic API model id, most
 * of which the Agent SDK does not accept as a subscription model alias.
 * Presenting it here would misrepresent this source as broader/more
 * dynamic than it actually is (source: OFFICIAL_STATIC_METADATA, never
 * ACCOUNT_DYNAMIC or PROVIDER_DYNAMIC) and could let a user pick a model
 * id the SDK rejects.
 */
class ClaudeSubscriptionDiscovery implements ProviderModelDiscovery {
  readonly providerId = 'claude-subscription';

  async discover(): Promise<DiscoveredModel[]> {
    const { CLAUDE_SUBSCRIPTION_MODELS } = await import(
      '../transports/claudeSubscription.js'
    );
    return CLAUDE_SUBSCRIPTION_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      reasoning: m.reasoning,
      api: 'claude-agent-sdk' as PlumbKnownApi,
    }));
  }
}

// ─── IBM watsonx.ai discovery (real live endpoint) ─────────────────────

/**
 * `watsonx` is a PLUMB-only synthetic (transports/watsonx.ts, official
 * `@ibm-cloud/watsonx-ai` SDK) with no OMP catalog descriptor. Unlike
 * claude-subscription, watsonx.ai DOES expose a real live model-list
 * endpoint (`GET /ml/v1/foundation_model_specs`, wrapped by the SDK's
 * `listFoundationModelSpecs()`), so this is genuine PROVIDER_DYNAMIC
 * discovery -- not a static/pinned list. Requires an API key; returns []
 * without one rather than guessing/caching a stale result.
 */
class WatsonxDiscovery implements ProviderModelDiscovery {
  readonly providerId = 'watsonx';

  async discover(context: DiscoveryContext): Promise<DiscoveredModel[]> {
    if (!context.apiKey) return [];
    try {
      const [
        { WatsonXAI },
        { IamAuthenticator },
        { resolveWatsonxServiceUrl },
      ] = await Promise.all([
        import('@ibm-cloud/watsonx-ai'),
        import('ibm-cloud-sdk-core'),
        import('../transports/watsonx.js'),
      ]);
      const client = WatsonXAI.newInstance({
        version: '2024-05-31',
        serviceUrl: resolveWatsonxServiceUrl(),
        authenticator: new IamAuthenticator({ apikey: context.apiKey }),
      });
      const response = await client.listFoundationModelSpecs({ limit: 200 });
      const resources = response.result.resources ?? [];
      return resources.map((m) => ({
        id: m.model_id,
        name: m.label,
        api: 'watsonx-chat' as PlumbKnownApi,
        // IBM's own foundation-model task taxonomy (`tasks[].id`) includes
        // 'function_calling' for models that support tool/function calling
        // -- this is real provider-reported metadata, never a guess from
        // the model name. Absent `tasks` data means unknown (undefined),
        // not `false`.
        toolsSupported: m.tasks
          ? m.tasks.some((t) => t.id === 'function_calling')
          : undefined,
      }));
    } catch {
      return [];
    }
  }
}

// ─── Discovery registry ────────────────────────────────────────────────

const DISCOVERIES = new Map<string, ProviderModelDiscovery>();

function register(discovery: ProviderModelDiscovery): void {
  DISCOVERIES.set(discovery.providerId, discovery);
}

// Register all known discovery adapters
register(new OllamaDiscovery());
register(new OpenAICompatLocalDiscovery('lm-studio', 'http://127.0.0.1:1234'));
register(new OpenAICompatLocalDiscovery('llama-cpp', 'http://127.0.0.1:8080'));
register(new OpenAICompatLocalDiscovery('vllm', 'http://127.0.0.1:8000'));
register(new OpenAICompatDiscovery('openai', 'https://api.openai.com'));
register(new OpenAICompatDiscovery('openrouter', 'https://openrouter.ai'));
register(new OpenAICompatDiscovery('groq', 'https://api.groq.com'));
register(new OpenAICompatDiscovery('mistral', 'https://api.mistral.ai'));
register(new OpenAICompatDiscovery('together', 'https://api.together.xyz'));
register(new OpenAICompatDiscovery('fireworks', 'https://api.fireworks.ai'));
register(new OpenAICompatDiscovery('deepseek', 'https://api.deepseek.com'));
register(new OpenAICompatDiscovery('moonshot', 'https://api.moonshot.cn'));
register(new OpenAICompatDiscovery('cerebras', 'https://api.cerebras.ai'));
register(
  new OpenAICompatDiscovery('nvidia', 'https://integrate.api.nvidia.com'),
);
register(new OpenAICompatDiscovery('novita', 'https://api.novita.ai'));
register(new OpenAICompatDiscovery('venice', 'https://api.venice.ai'));
register(new OpenAICompatDiscovery('perplexity', 'https://api.perplexity.ai'));
register(new ClaudeSubscriptionDiscovery());
register(new WatsonxDiscovery());

// Fill every remaining catalog provider (one with a standard model-manager
// factory) with the generic OMP-backed adapter. Hand-written adapters above
// always win — this only adds coverage, never replaces tested behavior.
// Registered under both the raw OMP id and its resolved PLUMB presentation
// id: a handful of OMP entries back two distinct PLUMB-facing ids (e.g.
// `anthropic` backs both the PLUMB `anthropic` OAuth-account provider and
// the `anthropic-api` direct-key provider — see PLUMB_TO_OMP_ID in
// catalog/providers.ts), and both must resolve to real discovery.
for (const descriptor of PROVIDER_DESCRIPTORS) {
  const plumbId = resolvePlumbProviderId(descriptor.providerId);
  if (!DISCOVERIES.has(descriptor.providerId)) {
    register(new OmpModelManagerDiscovery(descriptor.providerId, descriptor));
  }
  if (plumbId !== descriptor.providerId && !DISCOVERIES.has(plumbId)) {
    register(new OmpModelManagerDiscovery(plumbId, descriptor));
  }
}

/** Get the discovery adapter for a provider. */
export function getDiscovery(
  providerId: string,
): ProviderModelDiscovery | undefined {
  return DISCOVERIES.get(providerId);
}

/** Discover models from a provider using its adapter. */
export async function discoverProviderModels(
  providerId: string,
  context: DiscoveryContext,
): Promise<DiscoveredModel[]> {
  const discovery = DISCOVERIES.get(providerId);
  if (!discovery) return [];
  return discovery.discover(context);
}

/** Get all registered discovery provider IDs. */
export function getDiscoveryProviderIds(): string[] {
  return [...DISCOVERIES.keys()];
}

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  PlumbModel,
  PlumbProviderId,
  PlumbKnownApi,
  PlumbModelPricing,
} from '../types.js';
import { fetchOpenAICompatibleModels as ompFetchModels } from '../vendor-catalog/discovery/openai-compatible.js';
import { createModelManager } from '../vendor-catalog/model-manager.js';
import { installBunGlobal } from '../vendor-shims/bun-runtime.js';
import { PROVIDER_DESCRIPTORS } from '../vendor-catalog/provider-models/descriptors.js';
import type { ProviderDescriptor } from '../vendor-catalog/provider-models/descriptor-types.js';
import type { Api } from '../vendor-catalog/types.js';
import { resolvePlumbProviderId } from '../catalog/providers.js';
import { getBundledModels } from '../vendor-catalog/models.js';
import {
  resolveLocalProviderBaseUrl,
  resolveOllamaNativeBaseUrl,
} from '../config/localProviderConfig.js';
import { resolveGatewayProviderBaseUrl } from '../config/gatewayProviderConfig.js';
import {
  buildCustomProviderHeaders,
  getCustomProviderDefinition,
  type CustomProviderDefinition,
} from '../config/customProviderDefinitions.js';

export interface DiscoveryContext {
  providerId: PlumbProviderId;
  apiKey?: string;
  baseUrl?: string;
  oauthToken?: string;
}

export interface DiscoveredModel {
  id: string;
  name?: string;
  requestModelId?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  /** See `PlumbModel.toolsSupported` -- undefined means unknown, never guessed. */
  toolsSupported?: boolean;
  /**
   * Provenance of the toolsSupported value. Required when toolsSupported is
   * defined; omitted when toolsSupported is undefined (UNKNOWN).
   */
  toolsCapabilitySource?:
    | 'ACCOUNT_DYNAMIC'
    | 'PROVIDER_DYNAMIC'
    | 'SERVER_DYNAMIC'
    | 'BUNDLED_CATALOG'
    | 'PINNED_REFERENCE'
    | 'USER_CONFIGURED'
    | 'UNKNOWN';
  input?: PlumbModel['input'];
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
  source?: PlumbModel['source'];
  /**
   * Per-token pricing when the discovery source reports it. A model whose
   * upstream marks it explicitly free (e.g. OpenCode Zen's `-free`-suffixed
   * ids) carries an all-zero pricing record here -- real zero cost, not a
   * missing-data placeholder -- so callers can render a truthful FREE badge
   * instead of guessing from the id string themselves.
   */
  pricing?: PlumbModelPricing;
}

export interface ProviderModelDiscovery {
  providerId: string;
  discover(context: DiscoveryContext): Promise<DiscoveredModel[]>;
}

export type ModelDiscoveryStatus =
  | 'success'
  | 'empty'
  | 'unavailable'
  | 'error'
  | 'not_supported';

export interface ModelDiscoveryResult {
  models: DiscoveredModel[];
  status: ModelDiscoveryStatus;
  /** Safe classification only; never contains a URL, body, or credential. */
  errorCode?:
    | 'SERVER_UNAVAILABLE'
    | 'DISCOVERY_AUTH_FAILED'
    | 'DISCOVERY_HTTP_ERROR'
    | 'DISCOVERY_PROTOCOL_ERROR'
    | 'DISCOVERY_FAILED';
}

class ModelDiscoveryError extends Error {
  constructor(readonly code: NonNullable<ModelDiscoveryResult['errorCode']>) {
    super(code);
    this.name = 'ModelDiscoveryError';
  }
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
    const nativeBaseUrl = context.baseUrl
      ? context.baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '')
      : resolveOllamaNativeBaseUrl();
    const transportBaseUrl = `${nativeBaseUrl}/v1`;

    try {
      const response = await fetch(`${nativeBaseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
        ...(context.apiKey
          ? { headers: { Authorization: `Bearer ${context.apiKey}` } }
          : {}),
      });

      if (!response.ok) {
        throw new ModelDiscoveryError(
          response.status === 401 || response.status === 403
            ? 'DISCOVERY_AUTH_FAILED'
            : response.status >= 500
              ? 'SERVER_UNAVAILABLE'
              : 'DISCOVERY_HTTP_ERROR',
        );
      }

      let data: {
        models?: Array<{ name: string; details?: { parameter_size?: string } }>;
      };
      try {
        data = (await response.json()) as typeof data;
      } catch {
        throw new ModelDiscoveryError('DISCOVERY_PROTOCOL_ERROR');
      }
      if (data.models !== undefined && !Array.isArray(data.models)) {
        throw new ModelDiscoveryError('DISCOVERY_PROTOCOL_ERROR');
      }

      return await Promise.all(
        (data.models ?? []).map(async (m) => {
          let capabilities: string[] | undefined;
          let contextWindow: number | undefined;
          try {
            const showResponse = await fetch(`${nativeBaseUrl}/api/show`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(context.apiKey
                  ? { Authorization: `Bearer ${context.apiKey}` }
                  : {}),
              },
              body: JSON.stringify({ model: m.name }),
              signal: AbortSignal.timeout(5_000),
            });
            if (showResponse.ok) {
              const show = (await showResponse.json()) as {
                capabilities?: unknown;
                model_info?: Record<string, unknown>;
              };
              capabilities = Array.isArray(show.capabilities)
                ? show.capabilities.filter(
                    (value): value is string => typeof value === 'string',
                  )
                : undefined;
              for (const [key, value] of Object.entries(
                show.model_info ?? {},
              )) {
                if (
                  typeof value === 'number' &&
                  value > 0 &&
                  (key.endsWith('.context_length') ||
                    key.endsWith('.num_ctx') ||
                    key.endsWith('.context_window'))
                ) {
                  contextWindow = value;
                  break;
                }
              }
            }
          } catch {
            // `/api/show` enrichment is optional; the live tags result
            // remains authoritative for model identity.
          }

          return {
            id: m.name,
            name: m.name,
            contextWindow: contextWindow ?? 128000,
            maxTokens: 8192,
            reasoning: capabilities?.includes('thinking'),
            toolsSupported: capabilities?.includes('tools'),
            toolsCapabilitySource:
              capabilities !== undefined
                ? ('SERVER_DYNAMIC' as const)
                : undefined,
            input: capabilities
              ? capabilities.includes('vision')
                ? ('text+image' as const)
                : ('text' as const)
              : undefined,
            api: 'ollama-chat' as PlumbKnownApi,
            baseUrl: transportBaseUrl,
            source: 'SERVER_DYNAMIC' as const,
          };
        }),
      );
    } catch (error) {
      if (error instanceof ModelDiscoveryError) throw error;
      throw new ModelDiscoveryError('SERVER_UNAVAILABLE');
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
    const baseUrl =
      context.baseUrl ??
      resolveLocalProviderBaseUrl(this.providerId) ??
      this.defaultBaseUrl;

    let failure:
      | { kind: 'transport' | 'http' | 'protocol'; status?: number }
      | undefined;
    const models = await ompFetchModels<Api>({
      api: 'openai-completions',
      provider: this.providerId as Api,
      baseUrl,
      apiKey: context.apiKey,
      timeoutMs: 5_000,
      onFailure: (kind, status) => {
        failure = { kind, status };
      },
    });
    if (!models) {
      if (failure?.kind === 'protocol') {
        throw new ModelDiscoveryError('DISCOVERY_PROTOCOL_ERROR');
      }
      if (failure?.kind === 'http') {
        throw new ModelDiscoveryError(
          failure.status === 401 || failure.status === 403
            ? 'DISCOVERY_AUTH_FAILED'
            : (failure.status ?? 0) >= 500
              ? 'SERVER_UNAVAILABLE'
              : 'DISCOVERY_HTTP_ERROR',
        );
      }
      throw new ModelDiscoveryError('SERVER_UNAVAILABLE');
    }
    const lmStudioMetadata = new Map<
      string,
      { contextWindow?: number; input: PlumbModel['input'] }
    >();
    if (this.providerId === 'lm-studio') {
      try {
        const nativeBaseUrl = baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');
        const response = await fetch(`${nativeBaseUrl}/api/v0/models`, {
          headers: {
            Accept: 'application/json',
            ...(context.apiKey
              ? { Authorization: `Bearer ${context.apiKey}` }
              : {}),
          },
          signal: AbortSignal.timeout(2_000),
        });
        if (response.ok) {
          const payload = (await response.json()) as {
            data?: Array<Record<string, unknown>>;
          };
          for (const entry of payload.data ?? []) {
            if (typeof entry['id'] !== 'string') continue;
            const capabilities = Array.isArray(entry['capabilities'])
              ? entry['capabilities'].filter(
                  (value): value is string => typeof value === 'string',
                )
              : [];
            const isVision =
              entry['type'] === 'vlm' ||
              capabilities.some((value) =>
                ['vision', 'image'].includes(value.toLowerCase()),
              );
            const numericContext =
              entry['state'] === 'loaded'
                ? entry['loaded_context_length']
                : (entry['max_context_length'] ?? entry['context_length']);
            lmStudioMetadata.set(entry['id'], {
              ...(typeof numericContext === 'number' && numericContext > 0
                ? { contextWindow: numericContext }
                : undefined),
              input: isVision ? 'text+image' : 'text',
            });
          }
        }
      } catch {
        // Native metadata is optional; /v1/models remains authoritative.
      }
    }

    return models.map((m) => {
      const metadata = lmStudioMetadata.get(m.id);
      return {
        id: m.id,
        name: m.id,
        contextWindow: metadata?.contextWindow ?? 131072,
        maxTokens: 32768,
        input: metadata?.input,
        api: 'openai-completions' as PlumbKnownApi,
        baseUrl,
        source: 'SERVER_DYNAMIC' as const,
      };
    });
  }
}

// ─── OMP model-manager-backed discovery (generic fallback) ─────────────

/**
 * Generic discovery adapter backed by the OMP `createModelManager` /
 * `fetchDynamicModels` pipeline (`vendor-catalog/model-manager.ts`). Used for
 * every catalog provider that has a standard `{apiKey, baseUrl, fetch}`
 * model-manager factory (`PROVIDER_DESCRIPTORS`) but no hand-written adapter
 * above — this is what actually activates the dynamic-discovery machinery
 * already wired per-provider in `vendor-catalog/provider-models/*.ts` (Google
 * Gemini API, Vertex AI, GitHub Copilot, Anthropic, Azure, OpenRouter's OMP
 * variant, and ~35 others), which until this adapter existed was built,
 * tested, and governance-tracked but never actually called from the live
 * `PlumbModelRegistry` discovery path.
 *
 * `specialModelManager` providers (Antigravity, PLUMB, OpenAI Codex)
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
    // Descriptor factories themselves consult Bun.env and may build
    // endpoint-scoped cache ids with Bun.hash, so the shim must exist before
    // factory construction (not only before manager.refresh()).
    installBunGlobal();
    let options: ReturnType<ProviderDescriptor['createModelManagerOptions']>;
    try {
      options = this.descriptor.createModelManagerOptions({
        apiKey,
        baseUrl:
          context.baseUrl ??
          resolveLocalProviderBaseUrl(this.providerId) ??
          resolveGatewayProviderBaseUrl(this.providerId),
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
      // executes Bun-flavored code under Node (see vendor-shims/bun-runtime.ts).
      const manager = createModelManager<Api>(options);
      const result = await manager.refresh();
      return result.models.map((m) => ({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow ?? undefined,
        maxTokens: m.maxTokens ?? undefined,
        reasoning: m.reasoning,
        toolsSupported: m.supportsTools,
        toolsCapabilitySource:
          m.supportsTools !== undefined
            ? resolveLocalProviderBaseUrl(this.providerId)
              ? ('SERVER_DYNAMIC' as const)
              : ('PROVIDER_DYNAMIC' as const)
            : undefined,
        input: m.input.includes('image') ? 'text+image' : 'text',
        // The real wire dialect, NOT a hardcoded 'openai-completions' — this
        // provider may be anthropic-messages, google-vertex, etc. Callers
        // must use this instead of assuming OpenAI-compat.
        api: m.api as PlumbKnownApi,
        baseUrl: m.baseUrl,
        requestModelId: m.requestModelId,
        source: resolveLocalProviderBaseUrl(this.providerId)
          ? 'SERVER_DYNAMIC'
          : 'PROVIDER_DYNAMIC',
        ...(m.cost
          ? {
              pricing: {
                input: m.cost.input,
                output: m.cost.output,
                cacheRead: m.cost.cacheRead,
                cacheWrite: m.cost.cacheWrite,
              },
            }
          : undefined),
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
 * `OmpModelManagerDiscovery` bridge below never covers it.
 *
 * The pinned Agent SDK's `Query.supportedModels()` DOES expose a real,
 * account/plan-aware model list (populated from the live CLI subprocess's
 * own session-init handshake with Anthropic's backend) — see
 * `getClaudeSubscriptionModels` in transports/claudeSubscription.ts, which
 * this delegates to. This does NOT reuse the full bundled Anthropic
 * Developer Platform catalog: that catalog lists every Anthropic API model
 * id, most of which the Agent SDK does not accept as a subscription model
 * alias. `getClaudeSubscriptionModels` falls back to the pinned
 * `CLAUDE_SUBSCRIPTION_MODELS` floor (source: OFFICIAL_STATIC_METADATA)
 * whenever live discovery is unavailable, so the model count here never
 * drops below that floor.
 */
class ClaudeSubscriptionDiscovery implements ProviderModelDiscovery {
  readonly providerId = 'claude-subscription';

  async discover(): Promise<DiscoveredModel[]> {
    const { getClaudeSubscriptionModels } = await import(
      '../transports/claudeSubscription.js'
    );
    const { models, source } = await getClaudeSubscriptionModels();
    return models.map((m) => ({
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      reasoning: m.reasoning,
      toolsSupported: true,
      // The Agent SDK MCP bridge establishes client-tool support for this
      // subscription architecture. Preserve whether model identity itself
      // came from the authenticated SDK enumeration or the pinned two-model
      // Agent SDK reference floor.
      toolsCapabilitySource:
        source === 'ACCOUNT_DYNAMIC'
          ? ('ACCOUNT_DYNAMIC' as const)
          : ('PINNED_REFERENCE' as const),
      api: 'claude-agent-sdk' as PlumbKnownApi,
      source: m.source,
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
        toolsCapabilitySource:
          m.tasks !== undefined ? ('PROVIDER_DYNAMIC' as const) : undefined,
      }));
    } catch {
      return [];
    }
  }
}

/**
 * Amazon Bedrock live model discovery via the real `ListFoundationModels`
 * control-plane API (`GET https://bedrock.{region}.amazonaws.com/foundation-models`
 * -- a distinct host/API from `bedrock-runtime.{region}.amazonaws.com`,
 * which only handles inference, not catalog listing). Reuses the existing,
 * real, governance-owned AWS credential chain
 * (vendor-ai/providers/aws-credentials.ts: env -> profile static/SSO/
 * credential_process -> EC2 IMDSv2) and SigV4 signer
 * (vendor-ai/providers/aws-sigv4.ts) -- no second AWS credential resolution
 * path, no hand-rolled request signing.
 *
 * PROVENANCE HONESTY: `ListFoundationModels` returns the region-wide
 * foundation-model catalog, not this account's actual model-access grants
 * (Bedrock model access is a separate per-account opt-in the API does not
 * expose here) -- classified as `PROVIDER_DYNAMIC`, never `ACCOUNT_DYNAMIC`.
 * Filters `byOutputModality=TEXT` since PLUMB only offers chat models.
 */
class BedrockDiscovery implements ProviderModelDiscovery {
  readonly providerId = 'amazon-bedrock';

  async discover(context: DiscoveryContext): Promise<DiscoveredModel[]> {
    try {
      const [{ resolveAwsCredentials }, { signRequest }] = await Promise.all([
        import('../vendor-ai/providers/aws-credentials.js'),
        import('../vendor-ai/providers/aws-sigv4.js'),
      ]);
      const region =
        context.baseUrl?.trim() ||
        process.env['AWS_REGION']?.trim() ||
        process.env['AWS_DEFAULT_REGION']?.trim() ||
        'us-east-1';
      const credentials = await resolveAwsCredentials({ region });

      const host = `bedrock.${region}.amazonaws.com`;
      const path = '/foundation-models';
      const query = 'byOutputModality=TEXT';
      const body = new Uint8Array(0);
      const signed = await signRequest({
        method: 'GET',
        host,
        path,
        query,
        body,
        region,
        service: 'bedrock',
        credentials,
      });

      const response = await fetch(`https://${host}${path}?${query}`, {
        method: 'GET',
        headers: { ...signed },
      });
      if (!response.ok) return [];

      const json = (await response.json()) as {
        modelSummaries?: Array<{
          modelId: string;
          modelName?: string;
          responseStreamingSupported?: boolean;
          modelLifecycle?: { status?: string };
        }>;
      };
      const summaries = json.modelSummaries ?? [];
      return summaries
        .filter((m) => m.modelLifecycle?.status !== 'EOL')
        .map((m) => ({
          id: m.modelId,
          name: m.modelName ?? m.modelId,
          api: 'bedrock-converse-stream' as PlumbKnownApi,
        }));
    } catch {
      return [];
    }
  }
}

/**
 * Azure OpenAI deployment discovery.
 *
 * RESEARCHED AND REJECTED: Azure's old resource-level deployment-listing
 * data-plane API (`GET {endpoint}/openai/deployments?api-version=2023-03-15-preview`,
 * usable with the same simple API-key credential PLUMB's Azure OpenAI
 * provider already uses) is officially retired. The only remaining live
 * deployment-listing API is the Azure Resource Manager management plane
 * (`GET https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/
 * providers/Microsoft.CognitiveServices/accounts/{account}/deployments`),
 * which requires an entirely different, heavier credential authority (Azure
 * AD/Entra ID service-principal or `DefaultAzureCredential`-style OAuth
 * token scoped to `management.azure.com`, plus subscription/resource-group/
 * account identifiers) that a plain `AZURE_OPENAI_API_KEY` user does not
 * have configured in PLUMB at all today. Building that Azure AD/ARM
 * credential authority is real, separate scope -- not silently faked here.
 *
 * Until that ARM credential authority exists, this formalizes PLUMB's
 * existing manual mechanism (`AZURE_OPENAI_DEPLOYMENT_NAME_MAP`, already
 * consumed by vendor-ai/providers/azure-openai-responses.ts's
 * `resolveDeploymentName`/`parseAzureDeploymentNameMap`) into the same
 * discovery pipeline every other provider uses, so a user's configured
 * deployments actually show up in /model instead of being invisible until
 * a request is attempted. Provenance is honestly USER_CONFIGURED_DEPLOYMENT
 * (a manual mapping the user typed), never ACCOUNT_DYNAMIC -- PLUMB did not
 * verify these deployments exist by calling Azure.
 */
class AzureDeploymentDiscovery implements ProviderModelDiscovery {
  readonly providerId = 'azure';

  async discover(): Promise<DiscoveredModel[]> {
    const raw = process.env['AZURE_OPENAI_DEPLOYMENT_NAME_MAP'];
    if (!raw) return [];
    const { parseAzureDeploymentNameMap } = await import(
      '../vendor-ai/providers/openai-shared.js'
    );
    const map = parseAzureDeploymentNameMap(raw);
    return [...map.entries()].map(([modelId, deploymentName]) => ({
      id: modelId,
      name: `${modelId} -> ${deploymentName}`,
      api: 'azure-openai-responses' as PlumbKnownApi,
    }));
  }
}

// ─── Custom provider discovery (real listing endpoints only) ──────────

/**
 * Model listing for user-defined custom endpoints.
 *
 * All three supported dialects define a real listing endpoint, so PLUMB asks
 * for it -- but a private endpoint is free not to implement it. When the
 * listing is missing or unreadable the honest classification is surfaced and
 * NO models are invented; the definition's manually declared models remain
 * available separately and keep their `USER_CONFIGURED` provenance. Only
 * models the server itself reported are marked `SERVER_DYNAMIC`.
 */
class CustomProviderDiscovery implements ProviderModelDiscovery {
  constructor(private readonly definition: CustomProviderDefinition) {}

  get providerId(): string {
    return this.definition.id;
  }

  /** The dialect's real listing URL, plus any credential it carries. */
  #listingUrl(apiKey: string | undefined): string {
    const baseUrl = this.definition.baseUrl.replace(/\/+$/, '');
    if (this.definition.dialect === 'anthropic-messages') {
      return `${baseUrl}/v1/models`;
    }
    if (
      this.definition.dialect === 'google-generative-ai' &&
      this.definition.credentialPlacement === 'query-key' &&
      apiKey
    ) {
      return `${baseUrl}/models?key=${encodeURIComponent(apiKey)}`;
    }
    return `${baseUrl}/models`;
  }

  async discover(context: DiscoveryContext): Promise<DiscoveredModel[]> {
    const apiKey = context.apiKey ?? context.oauthToken;
    const headers = buildCustomProviderHeaders(this.definition, apiKey, {
      Accept: 'application/json',
      ...(this.definition.dialect === 'anthropic-messages'
        ? { 'anthropic-version': '2023-06-01' }
        : {}),
    });

    let response: Response;
    try {
      response = await fetch(this.#listingUrl(apiKey), {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ModelDiscoveryError('SERVER_UNAVAILABLE');
    }
    if (!response.ok) {
      throw new ModelDiscoveryError(
        response.status === 401 || response.status === 403
          ? 'DISCOVERY_AUTH_FAILED'
          : response.status >= 500
            ? 'SERVER_UNAVAILABLE'
            : 'DISCOVERY_HTTP_ERROR',
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ModelDiscoveryError('DISCOVERY_PROTOCOL_ERROR');
    }
    const ids = extractCustomModelIds(payload);
    if (ids === undefined) {
      throw new ModelDiscoveryError('DISCOVERY_PROTOCOL_ERROR');
    }

    return ids.map((id) => ({
      id,
      name: id,
      api: this.definition.dialect as PlumbKnownApi,
      baseUrl: this.definition.baseUrl,
      source: 'SERVER_DYNAMIC' as const,
    }));
  }
}

/**
 * Model IDs from any of the three listing shapes PLUMB's supported dialects
 * use: OpenAI/Anthropic `{data: [{id}]}` and Gemini `{models: [{name}]}`.
 * Returns undefined when the body is not a recognizable listing at all, so
 * the caller can report a protocol error instead of a silent empty result.
 */
function extractCustomModelIds(payload: unknown): string[] | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const entries =
    'data' in payload && Array.isArray(payload.data)
      ? payload.data
      : 'models' in payload && Array.isArray(payload.models)
        ? payload.models
        : undefined;
  if (entries === undefined) return undefined;

  const ids: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    // Gemini reports `models/<id>`; the wire id PLUMB sends is the suffix.
    const raw =
      'id' in entry && typeof entry.id === 'string'
        ? entry.id
        : 'name' in entry && typeof entry.name === 'string'
          ? entry.name.replace(/^models\//, '')
          : undefined;
    if (raw && !ids.includes(raw)) ids.push(raw);
  }
  return ids;
}

// ─── Discovery registry ────────────────────────────────────────────────

const DISCOVERIES = new Map<string, ProviderModelDiscovery>();

function register(discovery: ProviderModelDiscovery): void {
  DISCOVERIES.set(discovery.providerId, discovery);
}

// Register all known discovery adapters
register(new BedrockDiscovery());
register(new AzureDeploymentDiscovery());
register(new OllamaDiscovery());
register(
  new OpenAICompatLocalDiscovery('lm-studio', 'http://127.0.0.1:1234/v1'),
);
register(
  new OpenAICompatLocalDiscovery('llama-cpp', 'http://127.0.0.1:8080/v1'),
);
register(new OpenAICompatLocalDiscovery('sglang', 'http://127.0.0.1:30000/v1'));
register(new OpenAICompatDiscovery('openai', 'https://api.openai.com'));
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

/**
 * Get the discovery adapter for a provider.
 *
 * Custom providers are created at runtime, so they cannot live in the static
 * table -- their adapter is built from the current definition on every call,
 * which is also what keeps an edited base URL/dialect from being served by a
 * stale adapter.
 */
export function getDiscovery(
  providerId: string,
): ProviderModelDiscovery | undefined {
  const custom = getCustomProviderDefinition(providerId);
  if (custom) return new CustomProviderDiscovery(custom);
  return DISCOVERIES.get(providerId);
}

/** Discover models from a provider using its adapter. */
export async function discoverProviderModels(
  providerId: string,
  context: DiscoveryContext,
): Promise<DiscoveredModel[]> {
  return (await discoverProviderModelsDetailed(providerId, context)).models;
}

/** Discover models while preserving reachability/protocol/empty outcomes. */
export async function discoverProviderModelsDetailed(
  providerId: string,
  context: DiscoveryContext,
): Promise<ModelDiscoveryResult> {
  const discovery = getDiscovery(providerId);
  if (!discovery) return { models: [], status: 'not_supported' };
  try {
    const models = await discovery.discover(context);
    return {
      models,
      status: models.length > 0 ? 'success' : 'empty',
    };
  } catch (error) {
    const errorCode =
      error instanceof ModelDiscoveryError ? error.code : 'DISCOVERY_FAILED';
    return {
      models: [],
      status: errorCode === 'SERVER_UNAVAILABLE' ? 'unavailable' : 'error',
      errorCode,
    };
  }
}

/** Get all registered discovery provider IDs. */
export function getDiscoveryProviderIds(): string[] {
  return [...DISCOVERIES.keys()];
}

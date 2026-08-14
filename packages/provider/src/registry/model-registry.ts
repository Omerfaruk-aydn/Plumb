/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * PlumbModelRegistry — single authority for model discovery, caching, and selection.
 * Integrates: bundled catalog, runtime discovery, cache, custom models.
 */

import type {
  PlumbModel,
  PlumbProviderId,
  PlumbKnownApi,
  PlumbRouteEndpointFamily,
} from '../types.js';
import { getPlumbProvider, LOCAL_PROVIDERS } from '../catalog/providers.js';
import { getPlumbProviderRegistry } from './provider-registry.js';
import {
  getCatalogModels,
  getCatalogModel,
  getCatalogProviders,
} from '../catalog/model-catalog.js';
import {
  readModelCache,
  writeModelCache,
  invalidateModelCache,
  invalidateAllModelCache,
} from './model-cache.js';
import {
  discoverProviderModelsDetailed,
  getDiscovery,
  getDiscoveryProviderIds,
} from './model-discovery.js';
import type { ModelDiscoveryState } from '../toolRouteContract.js';
import {
  isLocalProviderId,
  resolveLocalProviderBaseUrl,
} from '../config/localProviderConfig.js';
import {
  isGatewayConfigProviderId,
  resolveGatewayProviderBaseUrl,
} from '../config/gatewayProviderConfig.js';
import {
  customDefinitionToModels,
  getCustomProviderDefinition,
  isCustomProviderId,
  listCustomProviderDefinitions,
} from '../config/customProviderDefinitions.js';

// ─── Model registry ───────────────────────────────────────────────────

/**
 * Compose dynamic discovered/custom model identity with rich bundled catalog metadata.
 * Live discovery provides identity, wire mapping, and any explicitly reported fields;
 * bundled catalog preserves toolsSupported, thinking, compat flags, and context limits
 * when discovered omission leaves them undefined.
 */
export function composeModel(
  discovered: PlumbModel,
  bundled?: PlumbModel,
): PlumbModel {
  if (!bundled) {
    return discovered;
  }
  return {
    ...bundled,
    ...discovered,
    name: discovered.name || bundled.name,
    api: discovered.api ?? bundled.api,
    requestModelId: discovered.requestModelId ?? bundled.requestModelId,
    baseUrl: discovered.baseUrl ?? bundled.baseUrl,
    contextWindow: discovered.contextWindow ?? bundled.contextWindow,
    maxTokens: discovered.maxTokens ?? bundled.maxTokens,
    reasoning:
      discovered.reasoning !== undefined
        ? discovered.reasoning
        : bundled.reasoning,
    toolsSupported:
      discovered.toolsSupported !== undefined
        ? discovered.toolsSupported
        : bundled.toolsSupported,
    toolsCapabilitySource:
      discovered.toolsSupported !== undefined
        ? (discovered.toolsCapabilitySource ?? 'SERVER_DYNAMIC')
        : (bundled.toolsCapabilitySource ??
          (bundled.toolsSupported !== undefined
            ? 'BUNDLED_CATALOG'
            : undefined)),
    input: discovered.input ?? bundled.input,
    source: discovered.source ?? bundled.source,
    pricing: discovered.pricing ?? bundled.pricing,
    thinking:
      (discovered as { thinking?: PlumbModel['thinking'] }).thinking ??
      bundled.thinking,
    openaiCompat:
      (discovered as { openaiCompat?: PlumbModel['openaiCompat'] })
        .openaiCompat ?? bundled.openaiCompat,
    anthropicCompat:
      (discovered as { anthropicCompat?: PlumbModel['anthropicCompat'] })
        .anthropicCompat ?? bundled.anthropicCompat,
    bedrockCompat:
      (discovered as { bedrockCompat?: PlumbModel['bedrockCompat'] })
        .bedrockCompat ?? bundled.bedrockCompat,
  };
}

export interface ResolveProbeModelInput {
  providerId: PlumbProviderId;
  requestedModel?: string;
  configuredModel?: string;
  targetDialect?: PlumbKnownApi;
  targetEndpointFamily?: PlumbRouteEndpointFamily;
  targetWireModel?: string;
  probeTools?: boolean;
}

export type RouteMismatchCategory =
  | 'NONE'
  | 'DIALECT_MISMATCH'
  | 'ENDPOINT_FAMILY_MISMATCH'
  | 'WIRE_MODEL_MISMATCH'
  | 'MODEL_ROUTE_UNSUPPORTED'
  | 'UNKNOWN_ROUTE_COMPAT';

export interface ResolvedModelSelection {
  model?: PlumbModel;
  source:
    | 'USER_EXPLICIT'
    | 'CONFIGURED_PREFERENCE'
    | 'PROVIDER_PREFERRED'
    | 'LIVE_AUTHORITY_FIRST'
    | 'STATIC_CATALOG_DEFAULT'
    | 'UNRESOLVED';
  displayId?: string;
  wireId?: string;
  providerAuthorityMatch: boolean;
  liveAuthorityMatch: boolean;
  routeAuthorityMatch: boolean;
  routeMismatchReason?: RouteMismatchCategory;
  fallbackReason: string;
}

function getEndpointFamilyForDialect(
  api: PlumbKnownApi,
): PlumbRouteEndpointFamily {
  switch (api) {
    case 'openai-completions':
    case 'openrouter':
    case 'ollama-chat':
      return 'OPENAI_CHAT_COMPLETIONS';
    case 'openai-responses':
    case 'azure-openai-responses':
    case 'oci-openai-responses':
    case 'openai-codex-responses':
      return 'OPENAI_RESPONSES';
    case 'anthropic-messages':
      return 'ANTHROPIC_MESSAGES';
    case 'bedrock-converse-stream':
      return 'AWS_BEDROCK_CONVERSE';
    case 'google-generative-ai':
    case 'google-gemini-cli':
      return 'GOOGLE_GENERATIVE_LANGUAGE';
    case 'google-vertex':
      return 'GOOGLE_VERTEX_PREDICTION';
    case 'claude-agent-sdk':
      return 'CLAUDE_AGENT_SDK';
    case 'watsonx-chat':
      return 'IBM_WATSONX_CHAT';
    case 'cursor-agent':
    case 'devin-agent':
    case 'gitlab-duo-agent':
      return 'PROVIDER_AGENT';
    default:
      return 'UNKNOWN';
  }
}

function evaluateRouteCompatibility(
  model: PlumbModel | undefined,
  input: ResolveProbeModelInput,
): { match: boolean; reason: RouteMismatchCategory } {
  if (!model) {
    return { match: false, reason: 'UNKNOWN_ROUTE_COMPAT' };
  }
  if (input.targetDialect && model.api !== input.targetDialect) {
    return { match: false, reason: 'DIALECT_MISMATCH' };
  }
  if (input.targetEndpointFamily) {
    const family = getEndpointFamilyForDialect(model.api);
    if (family !== input.targetEndpointFamily) {
      return { match: false, reason: 'ENDPOINT_FAMILY_MISMATCH' };
    }
  }
  if (input.targetWireModel) {
    const wireId = model.requestModelId ?? model.id;
    if (wireId !== input.targetWireModel) {
      return { match: false, reason: 'WIRE_MODEL_MISMATCH' };
    }
  }
  if (input.probeTools && model.toolsSupported === false) {
    return { match: false, reason: 'MODEL_ROUTE_UNSUPPORTED' };
  }
  return { match: true, reason: 'NONE' };
}

/** Live-vs-bundled authority counts for one provider. Used by the honest
 * batch tool-route probe so a provider whose only models are bundled
 * fallbacks is never silently treated as live authority. */
export interface PlumbModelAuthorityStats {
  readonly liveDiscoveryCount: number;
  readonly bundledFallbackCount: number;
  readonly customCount: number;
  /** Last recorded discovery attempt outcome (NOT_ATTEMPTED until one runs). */
  readonly discoveryState: ModelDiscoveryState;
}

export class PlumbModelRegistry {
  #customModels = new Map<string, PlumbModel>();
  #discoveredModels = new Map<string, PlumbModel>();
  #discoveryStates = new Map<string, ModelDiscoveryState>();
  #defaultModel: string | null = null;
  #smolModel: string | null = null;
  #planningModel: string | null = null;
  #listeners: Array<() => void> = [];

  // ── Model resolution ──────────────────────────────────────────────

  /** Get all models dynamically discovered for a provider. */
  getDiscoveredModels(providerId: PlumbProviderId): PlumbModel[] {
    const bundled = getCatalogModels(providerId);
    const bundledMap = new Map<string, PlumbModel>();
    for (const b of bundled) {
      bundledMap.set(b.id, b);
      if (b.requestModelId) bundledMap.set(b.requestModelId, b);
    }
    return [...this.#discoveredModels.values()]
      .filter((m) => m.provider === providerId)
      .map((m) => {
        const bundledMatch =
          bundledMap.get(m.id) ??
          (m.requestModelId ? bundledMap.get(m.requestModelId) : undefined);
        return composeModel(m, bundledMatch);
      });
  }

  /** Get all models available for a provider. Discovered models take precedence. */
  getModelsForProvider(providerId: PlumbProviderId): PlumbModel[] {
    const bundled = getCatalogModels(providerId);
    const custom = [...this.#customModels.values()].filter(
      (m) => m.provider === providerId,
    );
    const discovered = this.getDiscoveredModels(providerId);

    const bundledMap = new Map<string, PlumbModel>();
    for (const b of bundled) {
      bundledMap.set(b.id, b);
      if (b.requestModelId) bundledMap.set(b.requestModelId, b);
    }

    const seen = new Set<string>();
    const result: PlumbModel[] = [];

    for (const model of [...discovered, ...custom]) {
      if (!seen.has(model.id)) {
        seen.add(model.id);
        const bundledMatch =
          bundledMap.get(model.id) ??
          (model.requestModelId
            ? bundledMap.get(model.requestModelId)
            : undefined);
        result.push(composeModel(model, bundledMatch));
      }
    }

    for (const model of bundled) {
      if (!seen.has(model.id)) {
        seen.add(model.id);
        result.push(model);
      }
    }

    return result;
  }

  /** Get all models for all authenticated providers. */
  getAllAvailableModels(): PlumbModel[] {
    const registry = getPlumbProviderRegistry();
    const activeStates = registry.getActiveProviderStates();
    const models: PlumbModel[] = [];

    for (const state of activeStates) {
      models.push(...this.getModelsForProvider(state.provider.id));
    }

    return models;
  }

  /**
   * Per-provider authority counts: how many models were live-discovered for
   * this provider vs. how many exist only as bundled catalog fallbacks, plus
   * the recorded discovery attempt state. `liveDiscoveryCount === 0` alone is
   * NOT an authority verdict — read `discoveryState` to distinguish
   * NOT_ATTEMPTED / SUCCEEDED_EMPTY / AUTH_BLOCKED / SERVER_UNAVAILABLE /
   * NETWORK_FAILED / PROTOCOL_FAILED / UNSUPPORTED.
   */
  getModelAuthorityStats(
    providerId: PlumbProviderId,
  ): PlumbModelAuthorityStats {
    let liveDiscoveryCount = 0;
    let customCount = 0;
    for (const model of this.#discoveredModels.values()) {
      if (model.provider === providerId) liveDiscoveryCount++;
    }
    for (const model of this.#customModels.values()) {
      if (model.provider === providerId) customCount++;
    }
    return {
      liveDiscoveryCount,
      bundledFallbackCount: getCatalogModels(providerId).length,
      customCount,
      discoveryState: this.#discoveryStates.get(providerId) ?? 'NOT_ATTEMPTED',
    };
  }

  /** Whether this provider has any model-discovery capability at all. */
  hasDiscoveryCapability(providerId: PlumbProviderId): boolean {
    return (
      getDiscovery(providerId) !== undefined ||
      isLocalProviderId(providerId) ||
      isCustomProviderId(providerId)
    );
  }

  /**
   * Authoritative discovery attempt for the honest batch probe. Unlike
   * `refreshProvider`, this never invalidates existing cached models first —
   * a failed attempt must not destroy previously discovered authority. The
   * outcome is recorded as this provider's `discoveryState` and any
   * non-empty result is merged into the registry.
   */
  async attemptAuthoritativeDiscovery(
    providerId: PlumbProviderId,
    apiKey?: string,
    oauthToken?: string,
  ): Promise<{ models: PlumbModel[]; state: ModelDiscoveryState }> {
    const outcome = await discoverProviderModelsDetailed(providerId, {
      providerId,
      apiKey,
      oauthToken,
    });
    const state: ModelDiscoveryState =
      outcome.status === 'success'
        ? 'SUCCEEDED_NONEMPTY'
        : outcome.status === 'empty'
          ? 'SUCCEEDED_EMPTY'
          : outcome.status === 'unavailable'
            ? 'SERVER_UNAVAILABLE'
            : outcome.status === 'not_supported'
              ? 'UNSUPPORTED'
              : outcome.errorCode === 'DISCOVERY_AUTH_FAILED'
                ? 'AUTH_BLOCKED'
                : outcome.errorCode === 'DISCOVERY_PROTOCOL_ERROR'
                  ? 'PROTOCOL_FAILED'
                  : 'NETWORK_FAILED';
    this.#discoveryStates.set(providerId, state);

    const bundled = getCatalogModels(providerId);
    const bundledMap = new Map<string, PlumbModel>();
    for (const b of bundled) {
      bundledMap.set(b.id, b);
      if (b.requestModelId) bundledMap.set(b.requestModelId, b);
    }

    const models: PlumbModel[] = [];
    for (const m of outcome.models) {
      const rawModel: PlumbModel = {
        id: m.id,
        name: m.name ?? m.id,
        provider: providerId,
        api: m.api ?? 'openai-completions',
        ...(m.requestModelId
          ? { requestModelId: m.requestModelId }
          : undefined),
        ...(m.baseUrl ? { baseUrl: m.baseUrl } : undefined),
        contextWindow: m.contextWindow ?? 131072,
        maxTokens: m.maxTokens ?? 32768,
        ...(m.reasoning !== undefined ? { reasoning: m.reasoning } : undefined),
        ...(m.toolsSupported !== undefined
          ? { toolsSupported: m.toolsSupported }
          : undefined),
        ...(m.toolsCapabilitySource !== undefined
          ? { toolsCapabilitySource: m.toolsCapabilitySource }
          : undefined),
        input: m.input ?? 'text',
        ...(m.source ? { source: m.source } : undefined),
        ...(m.pricing ? { pricing: m.pricing } : undefined),
      };
      const bundledMatch =
        bundledMap.get(m.id) ??
        (m.requestModelId ? bundledMap.get(m.requestModelId) : undefined);
      const plumbModel = composeModel(rawModel, bundledMatch);
      this.#discoveredModels.set(`${providerId}:${m.id}`, plumbModel);
      models.push(plumbModel);
    }
    if (models.length > 0) {
      writeModelCache(providerId, models, true);
      this.#notifyListeners();
    }
    return { models, state };
  }

  /** Get all models including unauthenticated providers. */
  getAllModels(): PlumbModel[] {
    const providers = [
      ...getCatalogProviders(),
      ...listCustomProviderDefinitions().map((definition) => definition.id),
    ];
    const models: PlumbModel[] = [];
    for (const providerId of providers) {
      models.push(...this.getModelsForProvider(providerId));
    }
    return models;
  }

  /** Find a specific model by provider and ID. */
  findModel(
    providerId: PlumbProviderId,
    modelId: string,
  ): PlumbModel | undefined {
    const models = this.getModelsForProvider(providerId);
    return models.find((m) => m.id === modelId || m.requestModelId === modelId);
  }

  /** Find a model by reference string ("provider/model-id"). */
  findModelByReference(ref: string): PlumbModel | undefined {
    const parts = ref.split('/');
    if (parts.length === 2) {
      return this.findModel(parts[0], parts[1]);
    }
    for (const model of this.getAllAvailableModels()) {
      if (model.id === ref) return model;
    }
    return undefined;
  }

  /** Resolve the best model for a given provider. */
  resolveDefaultModel(providerId: PlumbProviderId): PlumbModel | undefined {
    return this.resolveModelSelection({ providerId }).model;
  }

  /**
   * Canonical model selection following the strict authority hierarchy:
   *
   *   1. USER_EXPLICIT (user passed an explicit model identifier)
   *   2. CONFIGURED_PREFERENCE (active configured model IF present in active authority set)
   *   3. PROVIDER_PREFERRED (provider defaultModel IF present in active authority set)
   *   4. LIVE_AUTHORITY_FIRST (first deterministic live-authority candidate when live)
   *      or STATIC_CATALOG_DEFAULT (first bundled fallback when statically authoritative)
   *   5. UNRESOLVED (honest unresolved when live discovery was empty or no candidates exist)
   */
  resolveModelSelection(input: ResolveProbeModelInput): ResolvedModelSelection {
    const { providerId, requestedModel, configuredModel } = input;
    const stats = this.getModelAuthorityStats(providerId);
    const discovered = this.getDiscoveredModels(providerId);
    const bundled = getCatalogModels(providerId);
    const provider = getPlumbProvider(providerId);

    if (requestedModel) {
      const model = this.findModel(providerId, requestedModel);
      if (model) {
        const wireId = model.requestModelId ?? model.id;
        const liveMatch = discovered.some(
          (d) =>
            d.id === model.id ||
            (model.requestModelId !== undefined &&
              (d.id === model.requestModelId ||
                d.requestModelId === model.requestModelId)),
        );
        const routeComp = evaluateRouteCompatibility(model, input);
        return {
          model,
          source: 'USER_EXPLICIT',
          displayId: model.id,
          wireId,
          providerAuthorityMatch: true,
          liveAuthorityMatch: liveMatch,
          routeAuthorityMatch: routeComp.match,
          routeMismatchReason: routeComp.reason,
          fallbackReason: 'none',
        };
      }
      return {
        model: undefined,
        source: 'USER_EXPLICIT',
        displayId: requestedModel,
        wireId: requestedModel,
        providerAuthorityMatch: false,
        liveAuthorityMatch: false,
        routeAuthorityMatch: false,
        routeMismatchReason: 'UNKNOWN_ROUTE_COMPAT',
        fallbackReason: 'requested_model_not_found',
      };
    }

    if (
      stats.discoveryState === 'SUCCEEDED_NONEMPTY' ||
      discovered.length > 0
    ) {
      // LIVE_DISCOVERED authority
      if (discovered.length === 0) {
        return {
          model: undefined,
          source: 'UNRESOLVED',
          providerAuthorityMatch: false,
          liveAuthorityMatch: false,
          routeAuthorityMatch: false,
          routeMismatchReason: 'UNKNOWN_ROUTE_COMPAT',
          fallbackReason: 'no_live_authority_models',
        };
      }

      // Restrict candidate set first to route-compatible models
      const routeCompatibleDiscovered = discovered.filter(
        (m) => evaluateRouteCompatibility(m, input).match,
      );

      if (routeCompatibleDiscovered.length === 0) {
        const firstM = discovered[0];
        const comp = evaluateRouteCompatibility(firstM, input);
        return {
          model: undefined,
          source: 'UNRESOLVED',
          providerAuthorityMatch: true,
          liveAuthorityMatch: true,
          routeAuthorityMatch: false,
          routeMismatchReason: comp.reason,
          fallbackReason: 'no_route_compatible_live_models',
        };
      }

      // 1. Check configured model
      if (configuredModel) {
        const match = routeCompatibleDiscovered.find(
          (m) =>
            m.id === configuredModel || m.requestModelId === configuredModel,
        );
        if (match) {
          return {
            model: match,
            source: 'CONFIGURED_PREFERENCE',
            displayId: match.id,
            wireId: match.requestModelId ?? match.id,
            providerAuthorityMatch: true,
            liveAuthorityMatch: true,
            routeAuthorityMatch: true,
            routeMismatchReason: 'NONE',
            fallbackReason: 'none',
          };
        }
      }

      // 2. Check provider preferred model
      if (provider?.defaultModel) {
        const match = routeCompatibleDiscovered.find(
          (m) =>
            m.id === provider.defaultModel ||
            m.requestModelId === provider.defaultModel,
        );
        if (match) {
          return {
            model: match,
            source: 'PROVIDER_PREFERRED',
            displayId: match.id,
            wireId: match.requestModelId ?? match.id,
            providerAuthorityMatch: true,
            liveAuthorityMatch: true,
            routeAuthorityMatch: true,
            routeMismatchReason: 'NONE',
            fallbackReason: 'none',
          };
        }
      }

      // 3. First deterministic live route-compatible candidate
      const first = routeCompatibleDiscovered[0];
      return {
        model: first,
        source: 'LIVE_AUTHORITY_FIRST',
        displayId: first.id,
        wireId: first.requestModelId ?? first.id,
        providerAuthorityMatch: true,
        liveAuthorityMatch: true,
        routeAuthorityMatch: true,
        routeMismatchReason: 'NONE',
        fallbackReason: provider?.defaultModel
          ? 'preferred_not_route_compatible_or_in_live_discovery'
          : configuredModel
            ? 'configured_not_route_compatible_or_in_live_discovery'
            : 'none',
      };
    }

    if (stats.discoveryState === 'SUCCEEDED_EMPTY') {
      // Honest LIVE_MODEL_UNRESOLVED — must NEVER pick bundled fallback
      return {
        model: undefined,
        source: 'UNRESOLVED',
        providerAuthorityMatch: false,
        liveAuthorityMatch: false,
        routeAuthorityMatch: false,
        routeMismatchReason: 'UNKNOWN_ROUTE_COMPAT',
        fallbackReason: 'discovery_empty_live_model_unresolved',
      };
    }

    // Static authoritative or un-attempted fallback
    if (bundled.length > 0) {
      const routeCompatibleBundled = bundled.filter(
        (m) => evaluateRouteCompatibility(m, input).match,
      );

      if (routeCompatibleBundled.length === 0) {
        const firstB = bundled[0];
        const comp = evaluateRouteCompatibility(firstB, input);
        return {
          model: undefined,
          source: 'UNRESOLVED',
          providerAuthorityMatch: true,
          liveAuthorityMatch: false,
          routeAuthorityMatch: false,
          routeMismatchReason: comp.reason,
          fallbackReason: 'no_route_compatible_bundled_models',
        };
      }

      if (configuredModel) {
        const match = routeCompatibleBundled.find(
          (m) =>
            m.id === configuredModel || m.requestModelId === configuredModel,
        );
        if (match) {
          return {
            model: match,
            source: 'CONFIGURED_PREFERENCE',
            displayId: match.id,
            wireId: match.requestModelId ?? match.id,
            providerAuthorityMatch: true,
            liveAuthorityMatch: false,
            routeAuthorityMatch: true,
            routeMismatchReason: 'NONE',
            fallbackReason: 'none',
          };
        }
      }

      if (provider?.defaultModel) {
        const match = routeCompatibleBundled.find(
          (m) =>
            m.id === provider.defaultModel ||
            m.requestModelId === provider.defaultModel,
        );
        if (match) {
          return {
            model: match,
            source: 'PROVIDER_PREFERRED',
            displayId: match.id,
            wireId: match.requestModelId ?? match.id,
            providerAuthorityMatch: true,
            liveAuthorityMatch: false,
            routeAuthorityMatch: true,
            routeMismatchReason: 'NONE',
            fallbackReason: 'none',
          };
        }
      }

      const first = routeCompatibleBundled[0];
      return {
        model: first,
        source: 'STATIC_CATALOG_DEFAULT',
        displayId: first.id,
        wireId: first.requestModelId ?? first.id,
        providerAuthorityMatch: true,
        liveAuthorityMatch: false,
        routeAuthorityMatch: true,
        routeMismatchReason: 'NONE',
        fallbackReason: 'none',
      };
    }

    return {
      model: undefined,
      source: 'UNRESOLVED',
      providerAuthorityMatch: false,
      liveAuthorityMatch: false,
      routeAuthorityMatch: false,
      routeMismatchReason: 'UNKNOWN_ROUTE_COMPAT',
      fallbackReason: 'no_models_available',
    };
  }

  // ── Custom models ─────────────────────────────────────────────────

  addCustomModel(model: PlumbModel): void {
    const key = `${model.provider}:${model.id}`;
    this.#customModels.set(key, model);
    this.#notifyListeners();
  }

  removeCustomModel(provider: PlumbProviderId, modelId: string): boolean {
    const key = `${provider}:${modelId}`;
    const result = this.#customModels.delete(key);
    if (result) this.#notifyListeners();
    return result;
  }

  /** Replace the in-memory manual model snapshot from persisted definitions. */
  hydrateCustomProviderModels(): void {
    for (const key of this.#customModels.keys()) {
      const providerId = key.slice(0, key.indexOf(':', 'custom:'.length));
      if (isCustomProviderId(providerId)) this.#customModels.delete(key);
    }
    for (const definition of listCustomProviderDefinitions()) {
      for (const model of customDefinitionToModels(definition)) {
        this.#customModels.set(`${model.provider}:${model.id}`, model);
      }
    }
    this.#notifyListeners();
  }

  // ── Discovery ─────────────────────────────────────────────────────

  /** Discover local models (Ollama, LM Studio, llama.cpp, vLLM). */
  async discoverLocalModels(): Promise<PlumbModel[]> {
    // Local provider set comes from the OMP-derived catalog facade
    // (LOCAL_PROVIDERS), not a hard-coded list.
    const localProviders = LOCAL_PROVIDERS.map((p) => p.id);
    const discovered: PlumbModel[] = [];

    for (const providerId of localProviders) {
      try {
        const providerRegistry = getPlumbProviderRegistry();
        providerRegistry.setProviderHealth(providerId, 'checking');
        let apiKey: string | undefined;
        try {
          apiKey = await providerRegistry.getApiKey(providerId);
        } catch {
          // Keyless local providers are valid; an unavailable credential
          // store must not prevent their discovery.
        }
        const outcome = await discoverProviderModelsDetailed(providerId, {
          providerId,
          apiKey,
        });
        providerRegistry.setProviderHealth(
          providerId,
          outcome.status === 'success' || outcome.status === 'empty'
            ? 'online'
            : outcome.status === 'unavailable'
              ? 'offline'
              : 'error',
          outcome.errorCode,
        );
        const models = outcome.models;
        const providerModels: PlumbModel[] = [];
        for (const m of models) {
          const plumbModel: PlumbModel = {
            id: m.id,
            name: m.name ?? m.id,
            provider: providerId,
            api: m.api ?? 'openai-completions',
            ...(m.baseUrl ? { baseUrl: m.baseUrl } : undefined),
            contextWindow: m.contextWindow ?? 131072,
            maxTokens: m.maxTokens ?? 32768,
            ...(m.reasoning !== undefined
              ? { reasoning: m.reasoning }
              : undefined),
            ...(m.toolsSupported !== undefined
              ? { toolsSupported: m.toolsSupported }
              : undefined),
            ...(m.toolsCapabilitySource !== undefined
              ? { toolsCapabilitySource: m.toolsCapabilitySource }
              : undefined),
            input: m.input ?? 'text',
            ...(m.source ? { source: m.source } : undefined),
          };
          const key = `${providerId}:${m.id}`;
          this.#discoveredModels.set(key, plumbModel);
          providerModels.push(plumbModel);
          discovered.push(plumbModel);
        }
        if (providerModels.length > 0)
          writeModelCache(providerId, providerModels, true);
      } catch {
        getPlumbProviderRegistry().setProviderHealth(
          providerId,
          'error',
          'DISCOVERY_FAILED',
        );
        // Discovery failure for a single provider is non-fatal
      }
    }

    if (discovered.length > 0) this.#notifyListeners();
    return discovered;
  }

  /** Discover models from a remote provider using its API. */
  async discoverProviderModels(
    providerId: PlumbProviderId,
    apiKey?: string,
    oauthToken?: string,
  ): Promise<PlumbModel[]> {
    try {
      const providerRegistry = getPlumbProviderRegistry();
      if (isLocalProviderId(providerId)) {
        providerRegistry.setProviderHealth(providerId, 'checking');
      }
      const outcome = await discoverProviderModelsDetailed(providerId, {
        providerId,
        apiKey,
        oauthToken,
      });
      // Record the canonical discovery state so later authority reads
      // distinguish AUTH_BLOCKED / SERVER_UNAVAILABLE / SUCCEEDED_EMPTY /
      // SUCCEEDED_NONEMPTY instead of seeing a bare zero count.
      this.#discoveryStates.set(
        providerId,
        outcome.status === 'success'
          ? 'SUCCEEDED_NONEMPTY'
          : outcome.status === 'empty'
            ? 'SUCCEEDED_EMPTY'
            : outcome.status === 'unavailable'
              ? 'SERVER_UNAVAILABLE'
              : outcome.status === 'not_supported'
                ? 'UNSUPPORTED'
                : outcome.errorCode === 'DISCOVERY_AUTH_FAILED'
                  ? 'AUTH_BLOCKED'
                  : outcome.errorCode === 'DISCOVERY_PROTOCOL_ERROR'
                    ? 'PROTOCOL_FAILED'
                    : 'NETWORK_FAILED',
      );
      if (isLocalProviderId(providerId)) {
        providerRegistry.setProviderHealth(
          providerId,
          outcome.status === 'success' || outcome.status === 'empty'
            ? 'online'
            : outcome.status === 'unavailable'
              ? 'offline'
              : 'error',
          outcome.errorCode,
        );
      }
      const discovered = outcome.models;

      const models: PlumbModel[] = [];
      for (const m of discovered) {
        const plumbModel: PlumbModel = {
          id: m.id,
          name: m.name ?? m.id,
          provider: providerId,
          // Use the adapter-reported wire dialect when present (the generic
          // OMP-backed adapter reports the model's real dialect — Anthropic
          // Messages, Vertex, etc.); only the hand-written adapters, which
          // are genuinely all OpenAI-compatible, rely on the fallback.
          api: m.api ?? 'openai-completions',
          ...(m.requestModelId
            ? { requestModelId: m.requestModelId }
            : undefined),
          ...(m.baseUrl ? { baseUrl: m.baseUrl } : undefined),
          contextWindow: m.contextWindow ?? 131072,
          maxTokens: m.maxTokens ?? 32768,
          ...(m.reasoning !== undefined
            ? { reasoning: m.reasoning }
            : undefined),
          ...(m.toolsSupported !== undefined
            ? { toolsSupported: m.toolsSupported }
            : undefined),
          ...(m.toolsCapabilitySource !== undefined
            ? { toolsCapabilitySource: m.toolsCapabilitySource }
            : undefined),
          input: m.input ?? 'text',
          ...(m.source ? { source: m.source } : undefined),
          ...(m.pricing ? { pricing: m.pricing } : undefined),
        };
        const key = `${providerId}:${m.id}`;
        this.#discoveredModels.set(key, plumbModel);
        models.push(plumbModel);
      }

      // Cache discovered models
      if (models.length > 0) {
        writeModelCache(providerId, models, true);
        this.#notifyListeners();
      }

      return models;
    } catch {
      if (isLocalProviderId(providerId)) {
        getPlumbProviderRegistry().setProviderHealth(
          providerId,
          'error',
          'DISCOVERY_FAILED',
        );
      }
      return [];
    }
  }

  /** Add discovered models from external source. */
  addDiscoveredModels(models: PlumbModel[]): void {
    for (const model of models) {
      const key = `${model.provider}:${model.id}`;
      this.#discoveredModels.set(key, model);
    }
    this.#notifyListeners();
  }

  // ── Cache ─────────────────────────────────────────────────────────

  /** Load cached models for a provider. */
  loadCache(providerId: PlumbProviderId): PlumbModel[] {
    const entry = readModelCache(providerId);
    if (!entry) return [];

    // A provider-only cache key is insufficient for configurable local
    // servers: after an endpoint edit, models discovered from endpoint A
    // must never be revived and sent to endpoint B. Reject legacy entries
    // without provenance as well as entries from a different base URL.
    if (
      isLocalProviderId(providerId) ||
      isGatewayConfigProviderId(providerId) ||
      isCustomProviderId(providerId)
    ) {
      const currentBaseUrl =
        resolveLocalProviderBaseUrl(providerId) ??
        resolveGatewayProviderBaseUrl(providerId) ??
        getCustomProviderDefinition(providerId)?.baseUrl;
      const matchesCurrentEndpoint =
        currentBaseUrl !== undefined &&
        entry.models.every(
          (model) =>
            model.baseUrl?.replace(/\/+$/, '') ===
            currentBaseUrl.replace(/\/+$/, ''),
        );
      if (!matchesCurrentEndpoint) {
        invalidateModelCache(providerId);
        return [];
      }
    }

    // Add cached models to discovered
    for (const model of entry.models) {
      const key = `${model.provider}:${model.id}`;
      if (!this.#discoveredModels.has(key)) {
        this.#discoveredModels.set(key, model);
      }
    }

    return entry.models;
  }

  /** Invalidate cache for a provider. */
  invalidateCache(providerId: PlumbProviderId): void {
    invalidateModelCache(providerId);
    // Remove discovered models for this provider
    for (const key of [...this.#discoveredModels.keys()]) {
      if (key.startsWith(`${providerId}:`)) {
        this.#discoveredModels.delete(key);
      }
    }
    this.#notifyListeners();
  }

  /** Invalidate all caches. */
  invalidateAllCaches(): void {
    invalidateAllModelCache();
    this.#discoveredModels.clear();
    this.#notifyListeners();
  }

  /** Refresh models for a provider (invalidate + rediscover). */
  async refreshProvider(
    providerId: PlumbProviderId,
    apiKey?: string,
    oauthToken?: string,
  ): Promise<PlumbModel[]> {
    this.invalidateCache(providerId);
    return this.discoverProviderModels(providerId, apiKey, oauthToken);
  }

  // ── Default model preferences ─────────────────────────────────────

  getDefaultModel(): string | null {
    return this.#defaultModel;
  }

  setDefaultModel(ref: string): void {
    this.#defaultModel = ref;
  }

  getSmolModel(): string | null {
    return this.#smolModel;
  }

  setSmolModel(ref: string | null): void {
    this.#smolModel = ref;
  }

  getPlanningModel(): string | null {
    return this.#planningModel;
  }

  setPlanningModel(ref: string | null): void {
    this.#planningModel = ref;
  }

  // ── Listeners ─────────────────────────────────────────────────────

  subscribeToChanges(listener: () => void): () => void {
    this.#listeners.push(listener);
    return () => {
      const idx = this.#listeners.indexOf(listener);
      if (idx >= 0) this.#listeners.splice(idx, 1);
    };
  }

  #notifyListeners(): void {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // Listener failure is non-fatal
      }
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────

  getStats(): {
    bundled: number;
    discovered: number;
    custom: number;
    total: number;
  } {
    const providers = getCatalogProviders();
    const bundled = providers.reduce(
      (sum, p) => sum + getCatalogModels(p).length,
      0,
    );
    return {
      bundled,
      discovered: this.#discoveredModels.size,
      custom: this.#customModels.size,
      total: bundled + this.#discoveredModels.size + this.#customModels.size,
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────

let defaultRegistry: PlumbModelRegistry | undefined;

export function getPlumbModelRegistry(): PlumbModelRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new PlumbModelRegistry();
  }
  return defaultRegistry;
}

export function resetPlumbModelRegistry(): void {
  defaultRegistry = undefined;
}

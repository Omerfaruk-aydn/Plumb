/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * PlumbModelRegistry — single authority for model discovery, caching, and selection.
 * Integrates: bundled catalog, runtime discovery, cache, custom models.
 */

import type { PlumbModel, PlumbProviderId, PlumbKnownApi } from '../types.js';
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
  getDiscoveryProviderIds,
} from './model-discovery.js';
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

export class PlumbModelRegistry {
  #customModels = new Map<string, PlumbModel>();
  #discoveredModels = new Map<string, PlumbModel>();
  #defaultModel: string | null = null;
  #smolModel: string | null = null;
  #planningModel: string | null = null;
  #listeners: Array<() => void> = [];

  // ── Model resolution ──────────────────────────────────────────────

  /** Get all models available for a provider. */
  getModelsForProvider(providerId: PlumbProviderId): PlumbModel[] {
    const bundled = getCatalogModels(providerId);
    const custom = [...this.#customModels.values()].filter(
      (m) => m.provider === providerId,
    );
    const discovered = [...this.#discoveredModels.values()].filter(
      (m) => m.provider === providerId,
    );

    const seen = new Set<string>();
    const result: PlumbModel[] = [];

    for (const model of [...bundled, ...discovered, ...custom]) {
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
    const provider = getPlumbProvider(providerId);
    const defaultId = provider?.defaultModel;
    if (defaultId) {
      const model = this.findModel(providerId, defaultId);
      if (model) return model;
    }
    const models = this.getModelsForProvider(providerId);
    return models[0];
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
          ...(m.baseUrl ? { baseUrl: m.baseUrl } : undefined),
          contextWindow: m.contextWindow ?? 131072,
          maxTokens: m.maxTokens ?? 32768,
          ...(m.reasoning !== undefined
            ? { reasoning: m.reasoning }
            : undefined),
          ...(m.toolsSupported !== undefined
            ? { toolsSupported: m.toolsSupported }
            : undefined),
          input: m.input ?? 'text',
          ...(m.source ? { source: m.source } : undefined),
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

/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * PlumbModelRegistry — manages model discovery, selection, and compatibility.
 * Derives from OMP's model-manager.ts and model-registry.ts.
 * Upstream source: D:\Kesit-next\packages\coding-agent\src\config\model-registry.ts
 * Upstream source: D:\Kesit-next\packages\catalog\src\model-manager.ts
 * Upstream license: MIT (c) 2025 Mario Zechner, (c) 2025-2026 Can Bölük
 */

import {
  type PlumbModel,
  type PlumbProviderId,
  type PlumbModelSpec,
  type PlumbKnownApi,
} from '../types.js';
import { getPlumbProvider } from '../catalog/providers.js';
import { getPlumbProviderRegistry } from '../registry/provider-registry.js';

// ─── Bundled model catalog ────────────────────────────────────────────

/**
 * Static model catalog derived from OMP's bundled models.json.
 * Each entry maps provider → model list.
 */
const BUNDLED_MODELS: Map<PlumbProviderId, PlumbModel[]> = new Map();

/** Register bundled models for a provider. */
export function registerBundledModels(
  provider: PlumbProviderId,
  models: PlumbModel[],
): void {
  BUNDLED_MODELS.set(provider, models);
}

// ─── Model registry ────────────────────────────────────────────────────

export class PlumbModelRegistry {
  #customModels = new Map<string, PlumbModel>();
  #discoveredModels = new Map<string, PlumbModel>();
  #defaultModel: string | null = null;
  #smolModel: string | null = null;
  #planningModel: string | null = null;

  // ── Model resolution ──────────────────────────────────────────────

  /** Get all models available for a provider. */
  getModelsForProvider(providerId: PlumbProviderId): PlumbModel[] {
    const bundled = BUNDLED_MODELS.get(providerId) ?? [];
    const custom = [...this.#customModels.values()].filter(
      (m) => m.provider === providerId,
    );
    const discovered = [...this.#discoveredModels.values()].filter(
      (m) => m.provider === providerId,
    );
    // Deduplicate by model ID
    const seen = new Set<string>();
    const result: PlumbModel[] = [];
    for (const m of [...bundled, ...custom, ...discovered]) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        result.push(m);
      }
    }
    return result;
  }

  /** Get all available models across all authenticated providers. */
  getAllAvailableModels(): PlumbModel[] {
    const registry = getPlumbProviderRegistry();
    const active = registry.getActiveProviderStates();
    const result: PlumbModel[] = [];
    const seen = new Set<string>();

    for (const state of active) {
      for (const model of this.getModelsForProvider(state.provider.id)) {
        const key = `${model.provider}:${model.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(model);
        }
      }
    }
    return result;
  }

  /** Find a model by provider + id. */
  findModel(
    providerId: PlumbProviderId,
    modelId: string,
  ): PlumbModel | undefined {
    const models = this.getModelsForProvider(providerId);
    return models.find((m) => m.id === modelId || m.requestModelId === modelId);
  }

  /** Find a model by full reference "provider/model-id". */
  findModelByReference(ref: string): PlumbModel | undefined {
    const parts = ref.split('/');
    if (parts.length === 2) {
      return this.findModel(parts[0], parts[1]);
    }
    // Search all providers
    for (const model of this.getAllAvailableModels()) {
      if (model.id === ref) return model;
    }
    return undefined;
  }

  /** Resolve the best model for a given provider (default model). */
  resolveDefaultModel(providerId: PlumbProviderId): PlumbModel | undefined {
    const provider = getPlumbProvider(providerId);
    const defaultId = provider?.defaultModel;
    if (defaultId) {
      const model = this.findModel(providerId, defaultId);
      if (model) return model;
    }
    // First available model
    const models = this.getModelsForProvider(providerId);
    return models[0];
  }

  // ── Custom models ─────────────────────────────────────────────────

  /** Add a custom model override. */
  addCustomModel(model: PlumbModel): void {
    const key = `${model.provider}:${model.id}`;
    this.#customModels.set(key, model);
  }

  /** Remove a custom model. */
  removeCustomModel(provider: PlumbProviderId, modelId: string): boolean {
    const key = `${provider}:${modelId}`;
    return this.#customModels.delete(key);
  }

  /** Add discovered models from a provider endpoint. */
  addDiscoveredModels(models: PlumbModel[]): void {
    for (const model of models) {
      const key = `${model.provider}:${model.id}`;
      this.#discoveredModels.set(key, model);
    }
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

  // ── Discovery ─────────────────────────────────────────────────────

  /** Discover local models (Ollama, LM Studio, llama.cpp). */
  async discoverLocalModels(): Promise<PlumbModel[]> {
    const discovered: PlumbModel[] = [];

    // Try Ollama
    try {
      const ollamaModels = await this.#fetchOllamaModels();
      for (const m of ollamaModels) {
        registerBundledModels('ollama', [m]);
        discovered.push(m);
      }
    } catch {
      // Ollama not available
    }

    // Try LM Studio
    try {
      await this.#probeEndpoint('http://127.0.0.1:1234/v1/models');
      // LM Studio is available — its models are discovered via the bundled list
    } catch {
      // LM Studio not available
    }

    return discovered;
  }

  async #fetchOllamaModels(): Promise<PlumbModel[]> {
    const response = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => ({
      id: m.name,
      provider: 'ollama' as PlumbProviderId,
      api: 'ollama-chat' as PlumbKnownApi,
      contextWindow: 128000,
      maxTokens: 16384,
      reasoning: false,
      input: 'text' as const,
    }));
  }

  async #probeEndpoint(url: string): Promise<void> {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────

let defaultModelRegistry: PlumbModelRegistry | undefined;

export function getPlumbModelRegistry(): PlumbModelRegistry {
  if (!defaultModelRegistry) {
    defaultModelRegistry = new PlumbModelRegistry();
  }
  return defaultModelRegistry;
}

export function resetPlumbModelRegistry(): void {
  defaultModelRegistry = undefined;
}

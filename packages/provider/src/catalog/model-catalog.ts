/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Complete model catalog loader (THIN PLUMB UI FACADE over the OMP authority).
 *
 * The bundled model data, provider set, and per-provider lookups are the
 * responsibility of the imported OMP runtime (`omp-catalog/models.ts`); this
 * module only projects the OMP `Model` records onto the PLUMB `PlumbModel`
 * shape the UI consumes.
 *
 * OMP source: packages/catalog/src/models.ts
 * OMP SHA: 4df68d60438423b384b2b47fb3d6835641624757
 */

import type { Model, Api, KnownProvider } from '../omp-catalog/types.js';
import type { GeneratedProvider } from '../omp-catalog/models.js';
import {
  getBundledModels,
  getBundledModel,
  getBundledProviders,
} from '../omp-catalog/models.js';
import type {
  PlumbModel,
  PlumbProviderId,
  PlumbKnownApi,
  PlumbModelPricing,
} from '../types.js';
import { resolveProviderAlias } from './providers.js';

// ─── OMP → PLUMB projection ────────────────────────────────────────────

const GENERATED_PROVIDERS = new Set<string>(getBundledProviders());

/**
 * Provider ids that share a catalog entry under a different id.
 * e.g. zai-coding-plan's models are under "zai" in the bundled catalog.
 */
const CATALOG_PROVIDER_FALLBACK: Readonly<Record<string, string>> = {
  'zai-coding-plan': 'zai',
};

/** True when an OMP provider id is a key of the bundled models.json. */
function isGeneratedProvider(id: string): id is GeneratedProvider {
  return GENERATED_PROVIDERS.has(id);
}

/** Resolve the catalog provider id for a PLUMB provider id. */
function resolveCatalogProviderId(providerId: string): string {
  return CATALOG_PROVIDER_FALLBACK[providerId] ?? resolveProviderAlias(providerId) ?? providerId;
}

/** Map an OMP `Model` onto the PLUMB `PlumbModel` shape. */
export function ompModelToPlumbModel(model: Model<Api>): PlumbModel {
  const pricing: PlumbModelPricing | undefined = model.cost
    ? {
        input: model.cost.input,
        output: model.cost.output,
        cacheRead: model.cost.cacheRead,
        cacheWrite: model.cost.cacheWrite,
      }
    : undefined;

  const input: PlumbModel['input'] = model.input.includes('image')
    ? 'text+image'
    : 'text';

  return {
    id: model.id,
    provider: model.provider as PlumbProviderId,
    name: model.name,
    api: model.api as PlumbKnownApi,
    requestModelId: model.requestModelId,
    contextWindow: model.contextWindow ?? 0,
    maxTokens: model.maxTokens ?? 0,
    reasoning: model.reasoning,
    input,
    pricing,
    baseUrl: model.baseUrl,
    isOAuth: model.isOAuth,
  };
}

// ─── Generated catalog accessors (delegated to OMP) ────────────────────

/** Get all providers present in the bundled model catalog. */
export function getCatalogProviders(): string[] {
  return getBundledProviders() as string[];
}

/** Get all models for a provider from the bundled OMP catalog. */
export function getCatalogModels(providerId: PlumbProviderId): PlumbModel[] {
  const resolvedId = resolveCatalogProviderId(providerId);
  if (!isGeneratedProvider(resolvedId)) return [];
  return getBundledModels(resolvedId).map(ompModelToPlumbModel);
}

/** Get a specific model from the catalog. */
export function getCatalogModel(
  providerId: PlumbProviderId,
  modelId: string,
): PlumbModel | undefined {
  const resolvedId = resolveCatalogProviderId(providerId);
  if (!isGeneratedProvider(resolvedId)) return undefined;
  const model = getBundledModel<Api>(resolvedId, modelId);
  if (!model) return undefined;
  return ompModelToPlumbModel(model);
}

/** Get the total model count in the catalog. */
export function getCatalogModelCount(): number {
  let count = 0;
  for (const providerId of getBundledProviders()) {
    if (isGeneratedProvider(providerId)) {
      count += getBundledModels(providerId).length;
    }
  }
  return count;
}

/** Get all models across all providers. */
export function getAllCatalogModels(): PlumbModel[] {
  const models: PlumbModel[] = [];
  for (const providerId of getBundledProviders()) {
    if (!isGeneratedProvider(providerId)) continue;
    for (const model of getBundledModels(providerId)) {
      models.push(ompModelToPlumbModel(model));
    }
  }
  return models;
}

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Complete model catalog loader.
 * Loads the deterministic generated catalog from OMP upstream.
 * Source: packages/catalog/src/models.json (OMP SHA: 4df68d60438423b384b2b47fb3d6835641624757)
 */

import type { PlumbModel, PlumbProviderId } from '../types.js';

// ─── Generated catalog ────────────────────────────────────────────────

let CATALOG: Record<string, Record<string, PlumbModel>> | null = null;

function loadCatalog(): Record<string, Record<string, PlumbModel>> {
  if (CATALOG) return CATALOG;
  try {
    // Dynamic import of the generated JSON
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    CATALOG = require('./generated-models.json') as Record<
      string,
      Record<string, PlumbModel>
    >;
    return CATALOG;
  } catch {
    CATALOG = {};
    return CATALOG;
  }
}

/** Get all providers in the catalog. */
export function getCatalogProviders(): string[] {
  return Object.keys(loadCatalog());
}

/** Get all models for a provider from the bundled catalog. */
export function getCatalogModels(providerId: PlumbProviderId): PlumbModel[] {
  const catalog = loadCatalog();
  const providerModels = catalog[providerId];
  if (!providerModels) return [];
  return Object.values(providerModels);
}

/** Get a specific model from the catalog. */
export function getCatalogModel(
  providerId: PlumbProviderId,
  modelId: string,
): PlumbModel | undefined {
  const catalog = loadCatalog();
  return catalog[providerId]?.[modelId];
}

/** Get the total model count in the catalog. */
export function getCatalogModelCount(): number {
  const catalog = loadCatalog();
  let count = 0;
  for (const provider of Object.values(catalog)) {
    count += Object.keys(provider).length;
  }
  return count;
}

/** Get all models across all providers. */
export function getAllCatalogModels(): PlumbModel[] {
  const catalog = loadCatalog();
  const models: PlumbModel[] = [];
  for (const providerModels of Object.values(catalog)) {
    models.push(...Object.values(providerModels));
  }
  return models;
}

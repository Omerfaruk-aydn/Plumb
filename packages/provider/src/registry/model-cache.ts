/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provider-scoped model cache (THIN PLUMB UI FACADE over the OMP authority).
 *
 * The storage format, freshness/TTL semantics, and cross-process access are
 * the responsibility of the imported OMP runtime (`omp-catalog/model-cache.ts`).
 * This module only adapts the PLUMB `PlumbModel` shape and keeps the legacy
 * `readModelCache`/`writeModelCache`/`invalidateModelCache`/`invalidateAllModelCache`
 * function signatures the model registry and barrel export.
 *
 * OMP source: packages/catalog/src/model-cache.ts
 * OMP SHA: 4df68d60438423b384b2b47fb3d6835641624757
 */

import type { PlumbModel, PlumbProviderId } from '../types.js';
import {
  readModelCache as readOmpModelCache,
  writeModelCache as writeOmpModelCache,
  removeModelCacheEntry,
  clearModelCache,
} from '../omp-catalog/model-cache.js';
import type { Api, Model } from '../omp-catalog/types.js';

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface PlumbCacheEntry {
  models: PlumbModel[];
  fresh: boolean;
  authoritative: boolean;
  updatedAt: number;
}

/**
 * Store `PlumbModel` records through the OMP cache. The OMP cache is
 * shape-agnostic (it stores opaque `ModelSpec[]` with TTL/freshness metadata),
 * so PLUMB models round-trip without field translation.
 */
export function readModelCache(
  providerId: PlumbProviderId,
  ttlMs: number = DEFAULT_TTL_MS,
): PlumbCacheEntry | null {
  const entry = readOmpModelCache<Api>(providerId, ttlMs);
  if (!entry) return null;
  return {
    models: entry.models as unknown as PlumbModel[],
    fresh: entry.fresh,
    authoritative: entry.authoritative,
    updatedAt: entry.updatedAt,
  };
}

export function writeModelCache(
  providerId: PlumbProviderId,
  models: PlumbModel[],
  authoritative: boolean,
): void {
  writeOmpModelCache<Api>(
    providerId,
    Date.now(),
    models as unknown as Model<Api>[],
    authoritative,
    '',
  );
}

export function invalidateModelCache(providerId: PlumbProviderId): void {
  removeModelCacheEntry(providerId);
}

export function invalidateAllModelCache(): void {
  clearModelCache();
}

export function closeModelCache(): void {
  // No-op for file-based cache
}

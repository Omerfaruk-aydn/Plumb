/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlumbModel, PlumbProviderId } from '../types.js';
import {
  readModelCache as readOmpModelCache,
  writeModelCache as writeOmpModelCache,
  removeModelCacheEntry,
  clearModelCache,
} from '../vendor-catalog/model-cache.js';
import type { Api, Model } from '../vendor-catalog/types.js';

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

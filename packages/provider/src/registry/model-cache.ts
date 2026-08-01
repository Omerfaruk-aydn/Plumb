/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provider-scoped model cache using JSON file storage.
 * Adapted from OMP packages/catalog/src/model-cache.ts
 * Upstream SHA: 4df68d60438423b384b2b47fb3d6835641624757
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PlumbModel, PlumbProviderId } from '../types.js';

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

interface CacheEntry {
  models: PlumbModel[];
  fresh: boolean;
  authoritative: boolean;
  updatedAt: number;
}

interface CacheFile {
  version: number;
  entries: Record<
    string,
    { models: PlumbModel[]; updatedAt: number; authoritative: boolean }
  >;
}

const CACHE_VERSION = 1;

function getCachePath(): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '/tmp';
  const dir = join(home, '.plumb');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'model-cache.json');
}

function loadCacheFile(): CacheFile {
  const path = getCachePath();
  try {
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf-8')) as CacheFile;
      if (data.version === CACHE_VERSION) return data;
    }
  } catch {
    // Corrupted cache — start fresh
  }
  return { version: CACHE_VERSION, entries: {} };
}

function saveCacheFile(cache: CacheFile): void {
  try {
    writeFileSync(getCachePath(), JSON.stringify(cache));
  } catch {
    // Cache write failure is non-fatal
  }
}

export function readModelCache(
  providerId: PlumbProviderId,
  ttlMs: number = DEFAULT_TTL_MS,
): CacheEntry | null {
  const cache = loadCacheFile();
  const entry = cache.entries[providerId];
  if (!entry) return null;

  const ageMs = Date.now() - entry.updatedAt;
  const fresh = ageMs >= 0 && ageMs <= ttlMs;

  return {
    models: entry.models,
    fresh,
    authoritative: entry.authoritative,
    updatedAt: entry.updatedAt,
  };
}

export function writeModelCache(
  providerId: PlumbProviderId,
  models: PlumbModel[],
  authoritative: boolean,
): void {
  const cache = loadCacheFile();
  cache.entries[providerId] = {
    models,
    updatedAt: Date.now(),
    authoritative,
  };
  saveCacheFile(cache);
}

export function invalidateModelCache(providerId: PlumbProviderId): void {
  const cache = loadCacheFile();
  delete cache.entries[providerId];
  saveCacheFile(cache);
}

export function invalidateAllModelCache(): void {
  saveCacheFile({ version: CACHE_VERSION, entries: {} });
}

export function closeModelCache(): void {
  // No-op for file-based cache
}

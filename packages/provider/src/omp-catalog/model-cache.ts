/**
 * JSON file-backed model cache for cross-process access.
 * Adapted from OMP's SQLite-backed cache for Node.js compatibility.
 *
 * OMP source: packages/catalog/src/model-cache.ts
 * OMP SHA: 4df68d60438423b384b2b47fb3d6835641624757
 * OMP license: MIT (c) 2025 Mario Zechner, (c) 2025-2026 Can Bölük
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getModelDbPath } from "../omp-shims/pi-utils.js";
import type { Api, Model, ModelSpec } from "./types.js";

const CACHE_SCHEMA_VERSION = 12;
const DEFAULT_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const NON_AUTHORITATIVE_RETRY_MS = 5 * 60 * 1000;

export interface CacheEntry<TApi extends Api = Api> {
	models: ModelSpec<TApi>[];
	fresh: boolean;
	authoritative: boolean;
	updatedAt: number;
	headerOmittedModelIds: readonly string[];
	unrestorableHeaderModelIds: readonly string[];
	legacyHeaderRestoreMarkers: boolean;
	staticFingerprint: string;
}

interface CacheFileRow {
	models: ModelSpec[];
	updatedAt: number;
	authoritative: boolean;
	staticFingerprint: string;
	headerOmittedModelIds: string[];
	unrestorableHeaderModelIds: string[];
	legacyHeaderRestoreMarkers: boolean;
}

interface CacheFile {
	version: number;
	entries: Record<string, CacheFileRow>;
}

function getCachePath(customPath?: string): string {
	if (customPath) return customPath;
	return getModelDbPath().replace(/\.db$/, ".json");
}

function loadCacheFile(customPath?: string): CacheFile {
	const path = getCachePath(customPath);
	try {
		if (existsSync(path)) {
			const data = JSON.parse(readFileSync(path, "utf-8")) as CacheFile;
			if (data.version === CACHE_SCHEMA_VERSION) return data;
		}
	} catch { /* corrupted */ }
	return { version: CACHE_SCHEMA_VERSION, entries: {} };
}

function saveCacheFile(cache: CacheFile, customPath?: string): void {
	try {
		const path = getCachePath(customPath);
		const dir = join(path, "..");
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(path, JSON.stringify(cache));
	} catch { /* non-fatal */ }
}

export function readModelCache<TApi extends Api = Api>(
	providerId: string,
	ttlMs: number = DEFAULT_CACHE_TTL_MS,
	now: () => number = Date.now,
	dbPath?: string,
): CacheEntry<TApi> | null {
	const cache = loadCacheFile(dbPath);
	const entry = cache.entries[providerId];
	if (!entry) return null;
	const ageMs = now() - entry.updatedAt;
	const effectiveTtl = entry.authoritative ? ttlMs : NON_AUTHORITATIVE_RETRY_MS;
	return {
		models: entry.models as ModelSpec<TApi>[],
		fresh: ageMs >= 0 && ageMs <= effectiveTtl,
		authoritative: entry.authoritative,
		updatedAt: entry.updatedAt,
		headerOmittedModelIds: entry.headerOmittedModelIds ?? [],
		unrestorableHeaderModelIds: entry.unrestorableHeaderModelIds ?? [],
		legacyHeaderRestoreMarkers: entry.legacyHeaderRestoreMarkers ?? false,
		staticFingerprint: entry.staticFingerprint ?? "",
	};
}

export function writeModelCache<TApi extends Api = Api>(
	providerId: string,
	updatedAt: number,
	models: Model<TApi>[],
	authoritative: boolean,
	staticFingerprint: string,
	dbPath?: string,
	staticHeaderSources: readonly Model<TApi>[] = [],
	_restorableHeaderFallback?: Record<string, string>,
): void {
	const cache = loadCacheFile(dbPath);
	const staticMap = new Map(staticHeaderSources.map(m => [m.id, m]));
	const omitted: string[] = [];
	for (const m of models) {
		if (m.headers && Object.keys(m.headers).length > 0 && !staticMap.has(m.id)) {
			omitted.push(m.id);
		}
	}
	const stripped = models.map(m => {
		if (!m.headers) return m;
		const { headers: _, ...rest } = m as ModelSpec<TApi> & { headers: Record<string, string> };
		return rest as ModelSpec<TApi>;
	});
	cache.entries[providerId] = {
		models: stripped as ModelSpec[],
		updatedAt,
		authoritative,
		staticFingerprint,
		headerOmittedModelIds: omitted,
		unrestorableHeaderModelIds: [],
		legacyHeaderRestoreMarkers: false,
	};
	saveCacheFile(cache, dbPath);
}

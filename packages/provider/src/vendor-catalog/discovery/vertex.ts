import { type } from "arktype";
import { resolveVertexEndpointHost } from "../hosts.js";
import { getBundledModels } from "../models.js";
import { toModelSpec } from "../provider-models/bundled-references.js";
import type { FetchImpl, Model, ModelSpec } from "../types.js";
import { discoveryFetch } from "../utils.js";

const API_VERSION = "v1";

const resilientString = type("unknown").pipe(val => {
	if (val === undefined) return undefined;
	const out = type("string")(val);
	return out instanceof type.errors ? undefined : out;
});

const resilientNumber = type("unknown").pipe(val => {
	if (val === undefined) return undefined;
	const out = type("number")(val);
	return out instanceof type.errors ? undefined : out;
});

// Vertex publisher-model `list` response mirrors the Generative AI Model
// resource (name, displayName, supportedActions) rather than the Generative
// Language API's `supportedGenerationMethods` shape.
const vertexModelListItemSchema = type({
	"name?": resilientString,
	"displayName?": resilientString,
	"launchStage?": resilientString,
	"inputTokenLimit?": resilientNumber,
	"outputTokenLimit?": resilientNumber,
	"supportedActions?": type({
		"generateContent?": "unknown",
	}),
});

type VertexModelListItem = typeof vertexModelListItemSchema.infer;

const modelsSchema = type("unknown[]")
	.pipe(items => {
		const parsedItems: VertexModelListItem[] = [];
		for (const item of items) {
			const parsed = vertexModelListItemSchema(item);
			if (!(parsed instanceof type.errors)) {
				parsedItems.push(parsed);
			}
		}
		return parsedItems;
	})
	.default(() => []);

const vertexModelListResponseSchema = type({
	models: modelsSchema,
	"nextPageToken?": resilientString,
});

/**
 * Configuration for Google Vertex AI publisher-model discovery.
 *
 * Only the `publishers/google/models` collection is queried — the same
 * resource `streamGoogleVertex` (../../vendor-ai/providers/google-vertex.ts)
 * targets for `:streamGenerateContent`. Non-Google Vertex publishers
 * (Anthropic, Meta, Mistral, ...) are served through a different wire shape
 * (`:rawPredict`/`:streamRawPredict`, see `isVertexRawPredictUrl`) and are
 * out of scope for this discovery path.
 *
 * Auth mirrors `streamGoogleVertex` exactly: an API key uses the
 * `publishers/google/models` collection directly (no project required,
 * `x-goog-api-key` header); OAuth/ADC requires `project`+`location` and
 * queries the project-scoped `projects/{project}/locations/{location}/publishers/google/models`
 * collection with a `Bearer` token.
 */
export interface VertexDiscoveryOptions {
	/** Vertex AI API key (`x-goog-api-key`). Mutually exclusive with `accessToken`. */
	apiKey?: string;
	/** OAuth/ADC access token (`Authorization: Bearer`). Mutually exclusive with `apiKey`. */
	accessToken?: string;
	/** Required when using `accessToken`; ignored (no project scoping) when using `apiKey`. */
	project?: string;
	/** Defaults to `global` for the apiKey path; required for the accessToken path. */
	location?: string;
	pageSize?: number;
	maxPages?: number;
	signal?: AbortSignal;
	fetch?: FetchImpl;
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 25;

/**
 * Fetches and normalizes Google Vertex AI (publisher `google`) models from
 * the live `publishers.models.list` endpoint.
 *
 * Returns `null` on transport/protocol/auth failures (callers fall back to
 * the static bundled catalog). Returns `[]` only when the endpoint responds
 * successfully with no usable models.
 */
export async function fetchVertexModels(options: VertexDiscoveryOptions): Promise<ModelSpec<"google-vertex">[] | null> {
	const apiKey = options.apiKey?.trim();
	const accessToken = options.accessToken?.trim();
	if (!apiKey && !accessToken) {
		return null;
	}

	const fetchImpl = discoveryFetch(options.fetch);
	const pageSize = normalizePositiveInt(options.pageSize, DEFAULT_PAGE_SIZE);
	const maxPages = normalizePositiveInt(options.maxPages, DEFAULT_MAX_PAGES);

	let host: string;
	let basePath: string;
	const headers: Record<string, string> = {};
	if (apiKey) {
		const location = options.location?.trim() || "global";
		host = resolveVertexEndpointHost(location);
		basePath = `${API_VERSION}/publishers/google/models`;
		headers["x-goog-api-key"] = apiKey;
	} else if (accessToken) {
		const project = options.project?.trim();
		const location = options.location?.trim();
		if (!project || !location) {
			return null;
		}
		host = resolveVertexEndpointHost(location);
		basePath = `${API_VERSION}/projects/${project}/locations/${location}/publishers/google/models`;
		headers.Authorization = `Bearer ${accessToken}`;
	} else {
		return null;
	}
	const baseUrl = `https://${host}`;

	const bundledById = new Map(
		getBundledModels("google-vertex").map(model => [model.id, toModelSpec(model as Model<"google-vertex">)]),
	);
	const modelsById = new Map<string, ModelSpec<"google-vertex">>();
	const seenTokens = new Set<string>();
	let nextPageToken: string | undefined;

	for (let page = 0; page < maxPages; page += 1) {
		const requestUrl = buildModelsUrl(host, basePath, pageSize, nextPageToken);
		let response: Response;
		try {
			response = await fetchImpl(requestUrl, {
				method: "GET",
				headers,
				signal: options.signal,
			});
		} catch {
			return null;
		}

		if (!response.ok) {
			return null;
		}

		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			return null;
		}

		const parsed = vertexModelListResponseSchema(payload);
		if (parsed instanceof type.errors) {
			return null;
		}

		for (const item of parsed.models) {
			const model = normalizeModel(item, bundledById, baseUrl);
			if (model) {
				modelsById.set(model.id, model);
			}
		}

		const token = normalizePageToken(parsed.nextPageToken);
		if (!token) {
			break;
		}
		if (seenTokens.has(token)) {
			break;
		}
		seenTokens.add(token);
		nextPageToken = token;
	}

	return Array.from(modelsById.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function buildModelsUrl(host: string, basePath: string, pageSize: number, pageToken?: string): URL {
	const url = new URL(`https://${host}/${basePath}`);
	url.searchParams.set("pageSize", String(pageSize));
	if (pageToken) {
		url.searchParams.set("pageToken", pageToken);
	}
	return url;
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	const normalized = Math.floor(value);
	return normalized > 0 ? normalized : fallback;
}

function normalizePageToken(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const token = value.trim();
	return token.length > 0 ? token : undefined;
}

function normalizeModel(
	item: VertexModelListItem,
	bundledById: Map<string, ModelSpec<"google-vertex">>,
	baseUrl: string,
): ModelSpec<"google-vertex"> | null {
	const id = normalizeModelId(item.name);
	if (!id) {
		return null;
	}
	// Only Model Garden entries that actually support generateContent are
	// usable through `streamGoogleVertex` (`:streamGenerateContent`).
	if (item.supportedActions !== undefined && item.supportedActions.generateContent === undefined) {
		return null;
	}

	const reference = bundledById.get(id);
	const contextWindow = item.inputTokenLimit ?? reference?.contextWindow ?? null;
	const maxTokens = item.outputTokenLimit ?? reference?.maxTokens ?? null;
	const name = item.displayName?.trim() || reference?.name || id;

	if (reference) {
		return {
			...reference,
			id,
			name,
			baseUrl,
			contextWindow,
			maxTokens,
		};
	}
	if (contextWindow === null || maxTokens === null) {
		// No bundled reference and the endpoint didn't report limits: too
		// little information to build a usable spec from scratch.
		return null;
	}
	return {
		id,
		name,
		api: "google-vertex",
		provider: "google-vertex",
		baseUrl,
		reasoning: inferReasoningFromModelId(id),
		input: inferInputFromModelId(id),
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens,
	};
}

function normalizeModelId(value: string | undefined): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	// `publishers/google/models/gemini-2.5-pro` -> `gemini-2.5-pro`.
	const marker = "/models/";
	const idx = trimmed.lastIndexOf(marker);
	return idx === -1 ? trimmed : trimmed.slice(idx + marker.length);
}

function inferReasoningFromModelId(id: string): boolean {
	const normalized = id.toLowerCase();
	return normalized.includes("thinking") || normalized.includes("pro") || normalized.includes("2.5");
}

function inferInputFromModelId(id: string): ("text" | "image")[] {
	const normalized = id.toLowerCase();
	if (normalized.includes("vision") || normalized.includes("image") || normalized.includes("gemini")) {
		return ["text", "image"];
	}
	return ["text"];
}

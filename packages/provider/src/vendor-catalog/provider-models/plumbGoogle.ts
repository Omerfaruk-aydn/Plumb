import { fetchAntigravityDiscoveryModels } from "../discovery/antigravity.js";
import { fetchGeminiModels } from "../discovery/plumbGemini.js";
import { fetchVertexModels } from "../discovery/vertex.js";
import type { ModelManagerOptions } from "../model-manager.js";
import type { FetchImpl } from "../types.js";
import { GEMINI_CLI_VARIANT_COLLAPSE_TABLE } from "../variant-collapse.js";

export interface GoogleModelManagerConfig {
	apiKey?: string;
	fetch?: FetchImpl;
}

export interface GoogleVertexModelManagerConfig {
	apiKey?: string;
	project?: string;
	location?: string;
	signal?: AbortSignal;
	fetch?: FetchImpl;
}

export interface GoogleAntigravityModelManagerConfig {
	oauthToken?: string;
	endpoint?: string;
	fetch?: FetchImpl;
}

export interface GoogleGeminiCliModelManagerConfig {
	oauthToken?: string;
	endpoint?: string;
	fetch?: FetchImpl;
}

const CLOUD_CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";

function toDiscoveryFetch(fetchImpl: FetchImpl | undefined): typeof fetch | undefined {
	if (!fetchImpl) {
		return undefined;
	}
	return Object.assign(
		(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetchImpl(input, init),
		{ preconnect: (fetchImpl as unknown as { preconnect?: (url: string) => void }).preconnect ?? (fetch as unknown as { preconnect?: (url: string) => void }).preconnect },
	);
}

export function googleModelManagerOptions(
	config?: GoogleModelManagerConfig,
): ModelManagerOptions<"google-generative-ai"> {
	const apiKey = config?.apiKey;
	return {
		providerId: "google",
		...(apiKey
			? { fetchDynamicModels: () => fetchGeminiModels({ apiKey, fetch: toDiscoveryFetch(config?.fetch) }) }
			: undefined),
	};
}

export function googleVertexModelManagerOptions(config?: GoogleVertexModelManagerConfig): ModelManagerOptions {
	// Only the API-key auth path is wired here: the `ModelManagerConfig` this
	// receives from the catalog descriptor only ever carries `apiKey`/`baseUrl`/
	// `fetch` (see descriptor-types.ts), never a project-scoped OAuth/ADC
	// access token. `fetchVertexModels` also accepts `accessToken`+`project`
	// for that path; wiring it through requires a config surface this call
	// site does not have yet.
	const apiKey = config?.apiKey;
	return {
		providerId: "google-vertex",
		...(apiKey
			? {
					fetchDynamicModels: () =>
						fetchVertexModels({
							apiKey,
							location: config?.location,
							fetch: toDiscoveryFetch(config?.fetch),
						}),
				}
			: undefined),
	};
}

export function googleAntigravityModelManagerOptions(
	config?: GoogleAntigravityModelManagerConfig,
): ModelManagerOptions<"google-gemini-cli"> {
	const token = config?.oauthToken;
	return {
		providerId: "google-antigravity",
		...(token
			? {
					fetchDynamicModels: () =>
						fetchAntigravityDiscoveryModels({
							token,
							endpoint: config?.endpoint,
							fetcher: toDiscoveryFetch(config?.fetch),
						}),
				}
			: undefined),
	};
}

export function googleGeminiCliModelManagerOptions(
	config?: GoogleGeminiCliModelManagerConfig,
): ModelManagerOptions<"google-gemini-cli"> {
	const token = config?.oauthToken;
	const endpoint = config?.endpoint ?? CLOUD_CODE_ASSIST_ENDPOINT;
	return {
		providerId: "google-gemini-cli",
		...(token
			? {
					fetchDynamicModels: async () => {
						const models = await fetchAntigravityDiscoveryModels({
							token,
							endpoint,
							fetcher: toDiscoveryFetch(config?.fetch),
							collapseTable: GEMINI_CLI_VARIANT_COLLAPSE_TABLE,
						});
						if (models === null) {
							return null;
						}
						return models.map(m => ({
							...m,
							provider: "google-gemini-cli" as const,
							baseUrl: endpoint,
						}));
					},
				}
			: undefined),
	};
}

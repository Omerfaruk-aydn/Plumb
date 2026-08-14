import { describe, expect, it, vi } from "vitest";
import { fetchVertexModels } from "./vertex.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
	return {
		ok,
		status,
		json: async () => body,
	} as Response;
}

describe("fetchVertexModels", () => {
	it("returns null when neither apiKey nor accessToken is provided", async () => {
		const fetchImpl = vi.fn();
		const result = await fetchVertexModels({ fetch: fetchImpl as unknown as typeof fetch });
		expect(result).toBeNull();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("returns null for the accessToken path when project or location is missing", async () => {
		const fetchImpl = vi.fn();
		const result = await fetchVertexModels({
			accessToken: "tok",
			fetch: fetchImpl as unknown as typeof fetch,
		});
		expect(result).toBeNull();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("queries publishers/google/models with x-goog-api-key for the apiKey path, defaulting location to global", async () => {
		const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
			const u = new URL(String(url));
			expect(u.hostname).toBe("aiplatform.googleapis.com");
			expect(u.pathname).toBe("/v1/publishers/google/models");
			expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
			return jsonResponse({
				models: [
					{
						name: "publishers/google/models/gemini-3.1-pro-preview",
						displayName: "Gemini 3.1 Pro Preview",
						inputTokenLimit: 1000000,
						outputTokenLimit: 65536,
						supportedActions: { generateContent: {} },
					},
				],
			});
		});

		const result = await fetchVertexModels({
			apiKey: "test-key",
			fetch: fetchImpl as unknown as typeof fetch,
		});

		expect(result).not.toBeNull();
		expect(result).toHaveLength(1);
		expect(result?.[0]).toMatchObject({
			id: "gemini-3.1-pro-preview",
			name: "Gemini 3.1 Pro Preview",
			api: "google-vertex",
			contextWindow: 1000000,
			maxTokens: 65536,
		});
	});

	it("queries the project-scoped path with a Bearer token for the accessToken path", async () => {
		const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
			const u = new URL(String(url));
			expect(u.hostname).toBe("us-central1-aiplatform.googleapis.com");
			expect(u.pathname).toBe("/v1/projects/my-project/locations/us-central1/publishers/google/models");
			expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
			return jsonResponse({ models: [] });
		});

		const result = await fetchVertexModels({
			accessToken: "tok",
			project: "my-project",
			location: "us-central1",
			fetch: fetchImpl as unknown as typeof fetch,
		});

		expect(result).toEqual([]);
	});

	it("filters out models whose supportedActions omit generateContent", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({
				models: [
					{
						name: "publishers/google/models/imagen-3",
						inputTokenLimit: 100,
						outputTokenLimit: 100,
						supportedActions: { predict: {} },
					},
				],
			}),
		);
		const result = await fetchVertexModels({
			apiKey: "k",
			fetch: fetchImpl as unknown as typeof fetch,
		});
		expect(result).toEqual([]);
	});

	it("drops models with no bundled reference and no reported token limits", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({
				models: [{ name: "publishers/google/models/some-unknown-model" }],
			}),
		);
		const result = await fetchVertexModels({
			apiKey: "k",
			fetch: fetchImpl as unknown as typeof fetch,
		});
		expect(result).toEqual([]);
	});

	it("returns null on a transport failure", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("network down");
		});
		const result = await fetchVertexModels({
			apiKey: "k",
			fetch: fetchImpl as unknown as typeof fetch,
		});
		expect(result).toBeNull();
	});

	it("returns null on a non-ok HTTP response", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({}, false, 403));
		const result = await fetchVertexModels({
			apiKey: "k",
			fetch: fetchImpl as unknown as typeof fetch,
		});
		expect(result).toBeNull();
	});

	it("paginates using nextPageToken until exhausted", async () => {
		let call = 0;
		const fetchImpl = vi.fn(async (url: unknown) => {
			call += 1;
			const u = new URL(String(url));
			if (call === 1) {
				expect(u.searchParams.get("pageToken")).toBeNull();
				return jsonResponse({
					models: [{ name: "publishers/google/models/model-a", inputTokenLimit: 10, outputTokenLimit: 10 }],
					nextPageToken: "page2",
				});
			}
			expect(u.searchParams.get("pageToken")).toBe("page2");
			return jsonResponse({
				models: [{ name: "publishers/google/models/model-b", inputTokenLimit: 10, outputTokenLimit: 10 }],
			});
		});
		const result = await fetchVertexModels({
			apiKey: "k",
			fetch: fetchImpl as unknown as typeof fetch,
		});
		expect(result?.map(m => m.id)).toEqual(["model-a", "model-b"]);
		expect(call).toBe(2);
	});
});

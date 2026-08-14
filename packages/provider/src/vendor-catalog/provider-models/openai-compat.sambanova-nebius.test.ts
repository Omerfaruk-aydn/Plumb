import { describe, it, expect, vi } from "vitest";
import { sambaNovaModelManagerOptions, nebiusModelManagerOptions } from "./openai-compat.js";

function jsonResponse(body: unknown): Response {
	return { ok: true, status: 200, json: async () => body } as Response;
}

describe("sambaNovaModelManagerOptions", () => {
	it("carries the SambaNova provider id", () => {
		const options = sambaNovaModelManagerOptions({ apiKey: "sn-key" });
		expect(options.providerId).toBe("sambanova");
	});

	it("has no dynamic fetcher when no apiKey is configured", () => {
		const options = sambaNovaModelManagerOptions();
		expect(options.fetchDynamicModels).toBeUndefined();
	});

	it("queries https://api.sambanova.ai/v1/models with a Bearer token and normalizes results", async () => {
		const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
			expect(String(url)).toBe("https://api.sambanova.ai/v1/models");
			expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sn-key");
			return jsonResponse({
				data: [{ id: "Meta-Llama-3.3-70B-Instruct", object: "model" }],
			});
		});

		const options = sambaNovaModelManagerOptions({
			apiKey: "sn-key",
			fetch: fetchImpl as unknown as typeof fetch,
		});
		expect(options.fetchDynamicModels).toBeDefined();
		const models = await options.fetchDynamicModels!();
		expect(models).not.toBeNull();
		expect(models?.map(m => m.id)).toContain("Meta-Llama-3.3-70B-Instruct");
		expect(models?.[0]?.api).toBe("openai-completions");
		expect(models?.[0]?.provider).toBe("sambanova");
	});

	it("returns null (not throw) on a transport failure", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("network down");
		});
		const options = sambaNovaModelManagerOptions({
			apiKey: "sn-key",
			fetch: fetchImpl as unknown as typeof fetch,
		});
		const models = await options.fetchDynamicModels!();
		expect(models).toBeNull();
	});
});

describe("nebiusModelManagerOptions", () => {
	it("carries the Nebius provider id", () => {
		const options = nebiusModelManagerOptions({ apiKey: "nb-key" });
		expect(options.providerId).toBe("nebius");
	});

	it("has no dynamic fetcher when no apiKey is configured", () => {
		const options = nebiusModelManagerOptions();
		expect(options.fetchDynamicModels).toBeUndefined();
	});

	it("queries https://api.studio.nebius.com/v1/models with a Bearer token", async () => {
		const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
			expect(String(url)).toBe("https://api.studio.nebius.com/v1/models");
			expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer nb-key");
			return jsonResponse({
				data: [{ id: "meta-llama/Meta-Llama-3.1-70B-Instruct", object: "model" }],
			});
		});

		const options = nebiusModelManagerOptions({
			apiKey: "nb-key",
			fetch: fetchImpl as unknown as typeof fetch,
		});
		const models = await options.fetchDynamicModels!();
		expect(models?.map(m => m.id)).toContain("meta-llama/Meta-Llama-3.1-70B-Instruct");
	});
});

import { describe, it, expect, vi } from "vitest";
import {
	cohereModelManagerOptions,
	byteplusModelArkModelManagerOptions,
	volcengineArkModelManagerOptions,
} from "./openai-compat.js";

function jsonResponse(body: unknown): Response {
	return { ok: true, status: 200, json: async () => body } as Response;
}

describe("cohereModelManagerOptions", () => {
	it("carries the cohere provider id and has no fetcher without an apiKey", () => {
		expect(cohereModelManagerOptions().providerId).toBe("cohere");
		expect(cohereModelManagerOptions().fetchDynamicModels).toBeUndefined();
	});

	it("queries https://api.cohere.ai/compatibility/v1/models with a Bearer token", async () => {
		const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
			expect(String(url)).toBe("https://api.cohere.ai/compatibility/v1/models");
			expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer co-key");
			return jsonResponse({ data: [{ id: "command-r7b-12-2024", object: "model" }] });
		});
		const options = cohereModelManagerOptions({ apiKey: "co-key", fetch: fetchImpl as unknown as typeof fetch });
		const models = await options.fetchDynamicModels!();
		expect(models?.map(m => m.id)).toContain("command-r7b-12-2024");
	});
});

describe("byteplusModelArkModelManagerOptions", () => {
	it("carries the byteplus-modelark provider id and has no fetcher without an apiKey", () => {
		expect(byteplusModelArkModelManagerOptions().providerId).toBe("byteplus-modelark");
		expect(byteplusModelArkModelManagerOptions().fetchDynamicModels).toBeUndefined();
	});

	it("queries https://ark.ap-southeast.bytepluses.com/api/v3/models with a Bearer token", async () => {
		const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
			expect(String(url)).toBe("https://ark.ap-southeast.bytepluses.com/api/v3/models");
			expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer bp-key");
			return jsonResponse({ data: [{ id: "doubao-seed-1-8-251228", object: "model" }] });
		});
		const options = byteplusModelArkModelManagerOptions({
			apiKey: "bp-key",
			fetch: fetchImpl as unknown as typeof fetch,
		});
		const models = await options.fetchDynamicModels!();
		expect(models?.map(m => m.id)).toContain("doubao-seed-1-8-251228");
	});
});

describe("volcengineArkModelManagerOptions", () => {
	it("carries the volcengine-ark provider id and has no fetcher without an apiKey", () => {
		expect(volcengineArkModelManagerOptions().providerId).toBe("volcengine-ark");
		expect(volcengineArkModelManagerOptions().fetchDynamicModels).toBeUndefined();
	});

	it("queries https://ark.cn-beijing.volces.com/api/v3/models with a Bearer token", async () => {
		const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
			expect(String(url)).toBe("https://ark.cn-beijing.volces.com/api/v3/models");
			expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer ve-key");
			return jsonResponse({ data: [{ id: "doubao-seed-1-8-251228", object: "model" }] });
		});
		const options = volcengineArkModelManagerOptions({
			apiKey: "ve-key",
			fetch: fetchImpl as unknown as typeof fetch,
		});
		const models = await options.fetchDynamicModels!();
		expect(models?.map(m => m.id)).toContain("doubao-seed-1-8-251228");
	});

	it("returns null (not throw) on a transport failure", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("network down");
		});
		const options = volcengineArkModelManagerOptions({
			apiKey: "ve-key",
			fetch: fetchImpl as unknown as typeof fetch,
		});
		const models = await options.fetchDynamicModels!();
		expect(models).toBeNull();
	});
});

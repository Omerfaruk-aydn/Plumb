import { describe, it, expect, vi } from "vitest";
import { portkeyModelManagerOptions } from "./openai-compat.js";

function jsonResponse(body: unknown): Response {
	return { ok: true, status: 200, json: async () => body } as Response;
}

describe("portkeyModelManagerOptions", () => {
	it("carries the portkey provider id and has no fetcher without an apiKey", () => {
		expect(portkeyModelManagerOptions().providerId).toBe("portkey");
		expect(portkeyModelManagerOptions().fetchDynamicModels).toBeUndefined();
	});

	it("queries https://api.portkey.ai/v1/models with a Bearer token", async () => {
		const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
			expect(String(url)).toBe("https://api.portkey.ai/v1/models");
			expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer pk-key");
			return jsonResponse({ data: [{ id: "gpt-5.5", object: "model" }] });
		});
		const options = portkeyModelManagerOptions({ apiKey: "pk-key", fetch: fetchImpl as unknown as typeof fetch });
		const models = await options.fetchDynamicModels!();
		expect(models?.map(m => m.id)).toContain("gpt-5.5");
	});

	it("returns null (not throw) on a transport failure", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("network down");
		});
		const options = portkeyModelManagerOptions({ apiKey: "pk-key", fetch: fetchImpl as unknown as typeof fetch });
		const models = await options.fetchDynamicModels!();
		expect(models).toBeNull();
	});
});

// @ts-nocheck
import type { ProviderDefinition } from "./types.js";

export const openaiProvider = {
	id: "openai",
	name: "OpenAI",
} as const satisfies ProviderDefinition;

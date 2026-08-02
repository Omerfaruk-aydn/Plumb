// @ts-nocheck
import type { ProviderDefinition } from "./types.js";

export const azureProvider = {
	id: "azure",
	name: "Azure OpenAI",
} as const satisfies ProviderDefinition;

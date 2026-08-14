// @ts-nocheck
import { createApiKeyLogin } from "./api-key-login.js";
import type { OAuthLoginCallbacks } from "./oauth/types.js";
import type { ProviderDefinition } from "./types.js";

export const loginZenMux = createApiKeyLogin({
	providerLabel: "ZenMux",
	authUrl: "https://zenmux.ai/settings/keys",
	instructions: "Create or copy your ZenMux API key",
	promptMessage: "Paste your ZenMux API key",
	placeholder: "sk-...",
	validation: {
		kind: "models-endpoint",
		provider: "ZenMux",
		modelsUrl: "https://zenmux.ai/api/v1/models",
	},
});

export const zenmuxProvider = {
	id: "zenmux",
	name: "ZenMux",
	login: (cb: OAuthLoginCallbacks) => loginZenMux(cb),
} as const satisfies ProviderDefinition;

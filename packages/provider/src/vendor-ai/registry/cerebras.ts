// @ts-nocheck
import { createApiKeyLogin } from "./api-key-login.js";
import type { OAuthLoginCallbacks } from "./oauth/types.js";
import type { ProviderDefinition } from "./types.js";

export const loginCerebras = createApiKeyLogin({
	providerLabel: "Cerebras",
	authUrl: "https://cloud.cerebras.ai/platform/",
	instructions: "Copy your API key from the Cerebras dashboard",
	promptMessage: "Paste your Cerebras API key",
	placeholder: "csk-...",
	validation: {
		kind: "chat-completions",
		provider: "Cerebras",
		baseUrl: "https://api.cerebras.ai/v1",
		model: "gpt-oss-120b",
	},
});

export const cerebrasProvider = {
	id: "cerebras",
	name: "Cerebras",
	login: (cb: OAuthLoginCallbacks) => loginCerebras(cb),
} as const satisfies ProviderDefinition;

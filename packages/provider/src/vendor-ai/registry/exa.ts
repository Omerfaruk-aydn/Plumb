// @ts-nocheck
import { createApiKeyLogin } from "./api-key-login.js";
import type { OAuthLoginCallbacks } from "./oauth/types.js";
import type { ProviderDefinition } from "./types.js";

export const loginExa = createApiKeyLogin({
	providerLabel: "Exa",
	authUrl: "https://dashboard.exa.ai/api-keys",
	instructions: "Create or copy your API key from the Exa dashboard.",
	promptMessage: "Paste your Exa API key",
	placeholder: "API key",
	validation: null,
});

export const exaProvider = {
	id: "exa",
	name: "Exa",
	envKeys: "EXA_API_KEY",
	login: (cb: OAuthLoginCallbacks) => loginExa(cb),
} as const satisfies ProviderDefinition;

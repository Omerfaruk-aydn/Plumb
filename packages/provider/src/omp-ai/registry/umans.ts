// @ts-nocheck
import { createApiKeyLogin } from "./api-key-login.js";
import type { OAuthLoginCallbacks } from "./oauth/types.js";
import type { ProviderDefinition } from "./types.js";

export const loginUmans = createApiKeyLogin({
	providerLabel: "Umans AI Coding Plan",
	authUrl: "https://app.umans.ai/billing",
	instructions: "Create or copy your Umans API key from Dashboard → API Keys.",
	promptMessage: "Paste your Umans API key",
	placeholder: "sk-...",
	validation: {
		kind: "anthropic-messages",
		provider: "Umans AI Coding Plan",
		baseUrl: "https://api.code.umans.ai",
		model: "umans-coder",
	},
});

export const umansProvider = {
	id: "umans",
	name: "Umans AI Coding Plan",
	login: (cb: OAuthLoginCallbacks) => loginUmans(cb),
} as const satisfies ProviderDefinition;

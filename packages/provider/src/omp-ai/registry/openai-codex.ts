// @ts-nocheck
import type { OAuthCredentials, OAuthLoginCallbacks } from "./oauth/types.js";
import type { ProviderDefinition } from "./types.js";

export const openaiCodexProvider = {
	id: "openai-codex",
	name: "ChatGPT Plus/Pro (Codex Subscription)",
	login: async (cb: OAuthLoginCallbacks) => {
		// Lazy import: keep heavy OAuth flow modules out of the eager registry graph.
		const { loginOpenAICodex } = await import("./oauth/openai-codex.js");
		return loginOpenAICodex(cb);
	},
	refreshToken: async (credentials: OAuthCredentials) => {
		// Lazy import: keep heavy OAuth flow modules out of the eager registry graph.
		const { refreshOpenAICodexToken } = await import("./oauth/openai-codex.js");
		return refreshOpenAICodexToken(credentials.refresh);
	},
	callbackPort: 1455,
	pasteCodeFlow: true,
} as const satisfies ProviderDefinition;

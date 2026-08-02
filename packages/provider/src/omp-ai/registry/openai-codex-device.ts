// @ts-nocheck
import type { OAuthCredentials, OAuthLoginCallbacks } from "./oauth/types.js";
import type { ProviderDefinition } from "./types.js";

export const openaiCodexDeviceProvider = {
	id: "openai-codex-device",
	name: "ChatGPT Plus/Pro (Codex, headless/device)",
	login: async (cb: OAuthLoginCallbacks) => {
		// Lazy import: keep heavy OAuth flow modules out of the eager registry graph.
		const { loginOpenAICodexDevice } = await import("./oauth/openai-codex.js");
		return loginOpenAICodexDevice(cb);
	},
	refreshToken: async (credentials: OAuthCredentials) => {
		// Lazy import: keep heavy OAuth flow modules out of the eager registry graph.
		const { refreshOpenAICodexToken } = await import("./oauth/openai-codex.js");
		return refreshOpenAICodexToken(credentials.refresh);
	},
	storeCredentialsAs: "openai-codex",
} as const satisfies ProviderDefinition;

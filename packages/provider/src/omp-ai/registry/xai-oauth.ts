// @ts-nocheck
import type { OAuthCredentials, OAuthLoginCallbacks } from "./oauth/types.js";
import type { ProviderDefinition } from "./types.js";

export const xaiOauthProvider = {
	id: "xai-oauth",
	name: "xAI Grok OAuth (SuperGrok or X Premium+)",
	login: async (cb: OAuthLoginCallbacks) => {
		// Lazy import: keep heavy OAuth flow modules out of the eager registry graph.
		const { loginXAIOAuth } = await import("./oauth/xai-oauth.js");
		return loginXAIOAuth(cb);
	},
	refreshToken: async (credentials: OAuthCredentials) => {
		// Lazy import: keep heavy OAuth flow modules out of the eager registry graph.
		const { refreshXAIOAuthToken } = await import("./oauth/xai-oauth.js");
		return refreshXAIOAuthToken(credentials.refresh);
	},
} as const satisfies ProviderDefinition;

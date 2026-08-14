// @ts-nocheck
import * as AIError from "../error/index.js";
import type { OAuthCredentials, OAuthLoginCallbacks } from "./oauth/types.js";
import type { ProviderDefinition } from "./types.js";

export const googleAntigravityProvider = {
	id: "google-antigravity",
	name: "Antigravity (Gemini 3, Claude, GPT-OSS)",
	login: async (cb: OAuthLoginCallbacks) => {
		// Lazy import: keep heavy OAuth flow modules out of the eager registry graph.
		const { loginAntigravity } = await import("./oauth/plumbGoogleAntigravity.js");
		return loginAntigravity(cb);
	},
	refreshToken: async (credentials: OAuthCredentials) => {
		if (!credentials.projectId) {
			throw new AIError.ConfigurationError("Antigravity credentials missing projectId");
		}
		const { refreshAntigravityToken } = await import("./oauth/plumbGoogleAntigravity.js");
		return refreshAntigravityToken(credentials.refresh, credentials.projectId);
	},
	callbackPort: 51121,
	pasteCodeFlow: true,
} as const satisfies ProviderDefinition;

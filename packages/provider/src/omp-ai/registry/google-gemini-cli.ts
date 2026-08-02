// @ts-nocheck
import * as AIError from "../error/index.js";
import type { OAuthCredentials, OAuthLoginCallbacks } from "./oauth/types.js";
import type { ProviderDefinition } from "./types.js";

export const googleGeminiCliProvider = {
	id: "google-gemini-cli",
	name: "Google Cloud Code Assist (Gemini CLI)",
	login: async (cb: OAuthLoginCallbacks) => {
		// Lazy import: keep heavy OAuth flow modules out of the eager registry graph.
		const { loginGeminiCli } = await import("./oauth/google-gemini-cli.js");
		return loginGeminiCli(cb);
	},
	refreshToken: async (credentials: OAuthCredentials) => {
		if (!credentials.projectId) {
			throw new AIError.ConfigurationError("Google Cloud credentials missing projectId");
		}
		const { refreshGoogleCloudToken } = await import("./oauth/google-gemini-cli.js");
		return refreshGoogleCloudToken(credentials.refresh, credentials.projectId);
	},
	callbackPort: 8085,
	pasteCodeFlow: true,
} as const satisfies ProviderDefinition;

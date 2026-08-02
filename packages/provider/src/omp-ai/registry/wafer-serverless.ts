// @ts-nocheck
import type { OAuthLoginCallbacks } from "./oauth/types.js";
import type { ProviderDefinition } from "./types.js";

export const waferServerlessProvider = {
	id: "wafer-serverless",
	name: "Wafer Serverless (pay-as-you-go)",
	login: async (cb: OAuthLoginCallbacks) => {
		// Lazy import: keep heavy OAuth flow modules out of the eager registry graph.
		const { loginWaferServerless } = await import("./oauth/wafer.js");
		return loginWaferServerless(cb);
	},
} as const satisfies ProviderDefinition;

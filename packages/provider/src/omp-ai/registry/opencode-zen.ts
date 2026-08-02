// @ts-nocheck
import type { OAuthLoginCallbacks } from "./oauth/types.js";
import type { ProviderDefinition } from "./types.js";

export const opencodeZenProvider = {
	id: "opencode-zen",
	name: "OpenCode Zen",
	login: async (cb: OAuthLoginCallbacks) => {
		// Lazy import: keep heavy OAuth flow modules out of the eager registry graph.
		const { loginOpenCode } = await import("./oauth/opencode.js");
		return loginOpenCode(cb);
	},
} as const satisfies ProviderDefinition;

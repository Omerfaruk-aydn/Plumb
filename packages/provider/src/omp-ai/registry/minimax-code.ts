// @ts-nocheck
import type { OAuthLoginCallbacks } from "./oauth/types.js";
import type { ProviderDefinition } from "./types.js";

export const minimaxCodeProvider = {
	id: "minimax-code",
	name: "MiniMax Token Plan (International)",
	login: async (cb: OAuthLoginCallbacks) => {
		// Lazy import: keep heavy OAuth flow modules out of the eager registry graph.
		const { loginMiniMaxCode } = await import("./oauth/minimax-code.js");
		return loginMiniMaxCode(cb);
	},
} as const satisfies ProviderDefinition;

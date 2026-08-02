// @ts-nocheck
import type { OAuthLoginCallbacks } from "./oauth/types.js";
import type { ProviderDefinition } from "./types.js";

export const minimaxCodeCnProvider = {
	id: "minimax-code-cn",
	name: "MiniMax Token Plan (China)",
	login: async (cb: OAuthLoginCallbacks) => {
		// Lazy import: keep heavy OAuth flow modules out of the eager registry graph.
		const { loginMiniMaxCodeCn } = await import("./oauth/minimax-code.js");
		return loginMiniMaxCodeCn(cb);
	},
} as const satisfies ProviderDefinition;

// @ts-nocheck
import * as AIError from "../error/index.js";
import type { OAuthController, OAuthLoginCallbacks, OAuthProvider } from "./oauth/types.js";
import type { ProviderDefinition } from "./types.js";

const PROVIDER_ID: OAuthProvider = "sglang";
const AUTH_URL = "https://docs.sglang.ai/backend/openai_api_completions.html";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:30000/v1";
const DEFAULT_LOCAL_TOKEN = "sglang-local";

export async function loginSglang(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new AIError.OnPromptRequiredError(PROVIDER_ID);
	}
	options.onAuth?.({
		url: AUTH_URL,
		instructions: `Paste your SGLang API key if your server requires auth. Leave empty for local no-auth mode (default base URL: ${DEFAULT_LOCAL_BASE_URL}).`,
	});
	const apiKey = await options.onPrompt({
		message: "Paste your SGLang API key (optional for local no-auth)",
		placeholder: DEFAULT_LOCAL_TOKEN,
		allowEmpty: true,
	});
	if (options.signal?.aborted) {
		throw new AIError.LoginCancelledError();
	}
	const trimmed = apiKey.trim();
	return trimmed || DEFAULT_LOCAL_TOKEN;
}

export const sglangProvider = {
	id: "sglang",
	name: "SGLang (Local OpenAI-compatible)",
	login: (cb: OAuthLoginCallbacks) => loginSglang(cb),
} as const satisfies ProviderDefinition;

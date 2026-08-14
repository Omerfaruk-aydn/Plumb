// @ts-nocheck
import type { KnownProvider } from "../../vendor-catalog/index.js";
import { aimlApiProvider } from "./aimlapi.js";
import { alibabaCodingPlanProvider } from "./alibaba-coding-plan.js";
import { alibabaTokenPlanProvider } from "./alibaba-token-plan.js";
import { amazonBedrockProvider } from "./amazon-bedrock.js";
import { anthropicProvider } from "./anthropic.js";
import { azureProvider } from "./azure.js";
import { basetenProvider } from "./baseten.js";
import { cerebrasProvider } from "./cerebras.js";
import { cloudflareAiGatewayProvider } from "./cloudflare-ai-gateway.js";
import { coreWeaveProvider } from "./coreweave.js";
import { cursorProvider } from "./cursor.js";
import { deepseekProvider } from "./deepseek.js";
import { devinProvider } from "./devin.js";
import { exaProvider } from "./exa.js";
import { firepassProvider } from "./firepass.js";
import { fireworksProvider } from "./fireworks.js";
import { githubCopilotProvider } from "./github-copilot.js";
import { gitlabDuoProvider } from "./gitlab-duo.js";
import { gitLabDuoWorkflowProvider } from "./gitlab-duo-workflow.js";
import { googleProvider } from "./plumbGoogle.js";
import { googleAntigravityProvider } from "./plumbGoogleAntigravity.js";
import { googleGeminiCliProvider } from "./plumbGoogleGeminiCli.js";
import { googleVertexProvider } from "./plumbGoogleVertex.js";
import { groqProvider } from "./groq.js";
import { huggingfaceProvider } from "./huggingface.js";
import { kagiProvider } from "./kagi.js";
import { kiloProvider } from "./kilo.js";
import { kimiCodeProvider } from "./kimi-code.js";
import { litellmProvider } from "./litellm.js";
import { llamaCppProvider } from "./llama-cpp.js";
import { lmStudioProvider } from "./lm-studio.js";
import { metaProvider } from "./meta.js";
import { minimaxProvider } from "./minimax.js";
import { minimaxCodeProvider } from "./minimax-code.js";
import { minimaxCodeCnProvider } from "./minimax-code-cn.js";
import { mistralProvider } from "./mistral.js";
import { moonshotProvider } from "./moonshot.js";
import { nanogptProvider } from "./nanogpt.js";
import { novitaProvider } from "./novita.js";
import { nvidiaProvider } from "./nvidia.js";
import { ollamaProvider } from "./ollama.js";
import { ollamaCloudProvider } from "./ollama-cloud.js";
import { openaiProvider } from "./openai.js";
import { openaiCodexProvider } from "./openai-codex.js";
import { openaiCodexDeviceProvider } from "./openai-codex-device.js";
import { opencodeGoProvider } from "./opencode-go.js";
import { opencodeZenProvider } from "./opencode-zen.js";
import { openrouterProvider } from "./openrouter.js";
import { parallelProvider } from "./parallel.js";
import { perplexityProvider } from "./perplexity.js";
import { qianfanProvider } from "./qianfan.js";
import { qwenPortalProvider } from "./qwen-portal.js";
import { sakanaProvider } from "./sakana.js";
import { siliconflowProvider } from "./siliconflow.js";
import { siliconflowCnProvider } from "./siliconflow-cn.js";
import { syntheticProvider } from "./synthetic.js";
import { tavilyProvider } from "./tavily.js";
import { togetherProvider } from "./together.js";
import type { ProviderDefinition } from "./types.js";
import { umansProvider } from "./umans.js";
import { veniceProvider } from "./venice.js";
import { vercelAiGatewayProvider } from "./vercel-ai-gateway.js";
import { vllmProvider } from "./vllm.js";
import { sglangProvider } from "./sglang.js";
import { waferServerlessProvider } from "./wafer-serverless.js";
import { xaiProvider } from "./xai.js";
import { xaiOauthProvider } from "./xai-oauth.js";
import { xiaomiProvider } from "./xiaomi.js";
import { xiaomiTokenPlanAmsProvider } from "./xiaomi-token-plan-ams.js";
import { xiaomiTokenPlanCnProvider } from "./xiaomi-token-plan-cn.js";
import { xiaomiTokenPlanSgpProvider } from "./xiaomi-token-plan-sgp.js";
import { zaiCodingPlanProvider, zaiProvider } from "./zai.js";
import { zenmuxProvider } from "./zenmux.js";
import { zhipuCodingPlanProvider } from "./zhipu-coding-plan.js";

/**
 * The single per-provider list. Adding a provider = create `./providers/<id>.ts`
 * and add its export here. Every legacy structure (`KnownProvider`/`OAuthProvider`
 * unions, descriptors, env map, login list, refresh/login dispatch, CLI callback
 * maps) is derived from this registry. Order matches the interactive `/login`
 * list for the loginable providers; non-login model providers are appended.
 */
const ALL = [
	azureProvider,
	openaiCodexProvider,
	anthropicProvider,
	zaiProvider,
	zaiCodingPlanProvider,
	kimiCodeProvider,
	openrouterProvider,
	githubCopilotProvider,
	cursorProvider,
	devinProvider,
	googleAntigravityProvider,
	googleGeminiCliProvider,
	openaiCodexDeviceProvider,
	xaiProvider,
	xaiOauthProvider,
	gitlabDuoProvider,
	gitLabDuoWorkflowProvider,
	alibabaCodingPlanProvider,
	alibabaTokenPlanProvider,
	aimlApiProvider,
	zhipuCodingPlanProvider,
	umansProvider,
	qwenPortalProvider,
	sakanaProvider,
	minimaxCodeProvider,
	minimaxCodeCnProvider,
	xiaomiProvider,
	xiaomiTokenPlanSgpProvider,
	xiaomiTokenPlanAmsProvider,
	xiaomiTokenPlanCnProvider,
	firepassProvider,
	deepseekProvider,
	metaProvider,
	moonshotProvider,
	cerebrasProvider,
	basetenProvider,
	fireworksProvider,
	togetherProvider,
	nvidiaProvider,
	novitaProvider,
	huggingfaceProvider,
	perplexityProvider,
	qianfanProvider,
	veniceProvider,
	siliconflowProvider,
	siliconflowCnProvider,
	syntheticProvider,
	nanogptProvider,
	waferServerlessProvider,
	coreWeaveProvider,
	vercelAiGatewayProvider,
	cloudflareAiGatewayProvider,
	litellmProvider,
	kiloProvider,
	zenmuxProvider,
	opencodeZenProvider,
	opencodeGoProvider,
	tavilyProvider,
	kagiProvider,
	exaProvider,
	parallelProvider,
	ollamaProvider,
	ollamaCloudProvider,
	lmStudioProvider,
	llamaCppProvider,
	vllmProvider,
	sglangProvider,
	openaiProvider,
	googleProvider,
	googleVertexProvider,
	groqProvider,
	mistralProvider,
	minimaxProvider,
	amazonBedrockProvider,
];

export type RegistryDef = (typeof ALL)[number];
export const PROVIDER_REGISTRY: readonly ProviderDefinition[] = ALL;

const BY_ID = new Map<string, ProviderDefinition>(ALL.map(p => [p.id, p] as [string, ProviderDefinition]));

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
	return BY_ID.get(id);
}

/** Compile-time completeness: every catalog chat-model provider must have a registry definition. */
type _MissingCatalogProviders = Exclude<KnownProvider, RegistryDef["id"]>;
type _CheckRegistryComplete = _MissingCatalogProviders extends never
	? true
	: ["registry is missing catalog providers", _MissingCatalogProviders];
true satisfies _CheckRegistryComplete;

/** Loginable providers (those carrying a `login` flow). */
export type OAuthProviderUnion = Extract<RegistryDef, { login: object }>["id"];

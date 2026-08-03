/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * OMP-derived provider catalog (THIN OMP → PLUMB projection facade).
 *
 * The authoritative provider inventory — which providers exist, their names,
 * availability, default models, env vars, OAuth capability, and
 * allow-unauthenticated state — comes from the imported OMP runtime:
 *   - `PROVIDER_REGISTRY` (omp-ai/registry/registry.ts): per-provider auth
 *     wiring (id, name, available, login/refresh flows, env keys, callback
 *     port, paste-code flag).
 *   - `CATALOG_PROVIDERS` (omp-catalog/provider-models/descriptors.ts):
 *     per-provider model-catalog metadata (default model, env vars,
 *     allow-unauthenticated, dynamic-models-authoritative).
 *
 * This module is NOT an independent provider inventory. It only:
 *   1. resolves PLUMB ids to their OMP backing (aliases + PLUMB-only
 *      synthetics are declared explicitly);
 *   2. projects OMP fields onto the PLUMB `PlumbProvider` shape;
 *   3. overlays PLUMB-only presentation (category, group, order,
 *      description, auth-method UX labels) that have no OMP counterpart.
 *
 * Upstream source: https://github.com/can1357/oh-my-pi.git
 * Upstream SHA: 4df68d60438423b384b2b47fb3d6835641624757
 * Upstream source: packages/ai/src/registry/registry.ts
 * Upstream source: packages/catalog/src/provider-models/descriptors.ts
 * Upstream license: MIT (c) 2025 Mario Zechner, (c) 2025-2026 Can Bölük
 */

import type { PlumbProvider, PlumbProviderId } from '../types.js';
import { PlumbProviderCategory, type PlumbAuthMethod } from '../types.js';
import {
  PROVIDER_REGISTRY,
  getProviderDefinition,
} from '../omp-ai/registry/registry.js';
import type { ProviderDefinition } from '../omp-ai/registry/types.js';
import { getCatalogProviderEntry } from '../omp-catalog/provider-models/descriptors.js';

// ─── PLUMB → OMP id resolution ─────────────────────────────────────────

/**
 * PLUMB presentation ids that map to a differently-named OMP registry id.
 * The PLUMB id is what the UI/settings/commands use; the OMP id is the
 * authority the registry and catalog key on.
 */
const PLUMB_TO_OMP_ID: Readonly<Record<string, string>> = {
  antigravity: 'google-antigravity',
  'llama-cpp': 'llama.cpp',
  'anthropic-api': 'anthropic',
};

/**
 * Resolve a PLUMB provider id to its canonical OMP registry id.
 * Returns the OMP id for aliased providers, or the input id when no alias exists.
 */
export function resolveProviderAlias(plumbId: string): string {
  return PLUMB_TO_OMP_ID[plumbId] ?? plumbId;
}

/**
 * PLUMB-only synthetic providers with no OMP registry/catalog backing.
 * These are legitimate PLUMB product surfaces (a generic OpenAI-compatible
 * custom endpoint, and the legacy Google account login) that the OMP runtime
 * has no descriptor for; they are declared here as the projection's explicit
 * non-OMP surface.
 */
const PLUMB_SYNTHETIC_IDS: ReadonlySet<string> = new Set([
  'custom-openai-compat',
  'google-login',
]);

/**
 * Providers whose OAuth client registration belongs to the upstream product
 * and is NOT valid for PLUMB (PLUMB's redirect URI is not registered with
 * the upstream client). These providers must NOT be selectable as working
 * OAuth login flows. API-key access remains available separately.
 */
const BLOCKED_CLIENT_REGISTRATIONS: ReadonlySet<string> = new Set([
  'openai-codex',
]);

/**
 * Providers with no OMP catalog descriptor and no OMP registry definition.
 * These providers have no bundled models, no live-discovery factory, and
 * no login flow. They must NOT be selectable until a catalog descriptor
 * or registry definition is added.
 *
 * NOTE: llama-cpp and perplexity are NOT here — both have OMP registry
 * definitions with `login` functions and are available through that path.
 * llama-cpp is a local provider (server may be offline → LOCAL_RUNTIME_NOT_AVAILABLE).
 * perplexity has bundled OMP catalog models via kilo/nanogpt gateways.
 */
const BLOCKED_NO_MODEL_SOURCE: ReadonlySet<string> = new Set([]);

/** The set of OMP registry provider ids, built once from PROVIDER_REGISTRY. */
const OMP_REGISTRY_IDS: ReadonlySet<string> = new Set(
  PROVIDER_REGISTRY.map((p) => p.id),
);

// ─── PLUMB-only presentation overlay ───────────────────────────────────

interface PlumbPresentation {
  category: PlumbProviderCategory;
  group: string;
  order: number;
  description?: string;
  /** PLUMB-only auth-method UX (labels, prompts). Empty array = derive from OMP. */
  authMethods?: PlumbAuthMethod[];
}

/** PLUMB-only presentation fields (no OMP counterpart). */
const PRESENTATION: Readonly<Record<string, PlumbPresentation>> = {
  'openai-codex': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 1,
    description: 'OpenAI Codex subscription via ChatGPT Plus or Pro',
    authMethods: [
      { type: 'oauth', port: 1455, pasteCode: true },
      { type: 'device_code' },
    ],
  },
  'github-copilot': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 2,
    description: 'GitHub Copilot subscription',
    authMethods: [{ type: 'oauth', pasteCode: true }],
  },
  cursor: {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 3,
    description: 'Cursor IDE subscription',
    authMethods: [{ type: 'oauth', pasteCode: true }],
  },
  'kimi-code': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 4,
    description: 'Moonshot Kimi coding plan',
    authMethods: [{ type: 'oauth', pasteCode: true }],
  },
  'minimax-code': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 5,
    description: 'MiniMax coding subscription',
    authMethods: [{ type: 'oauth', pasteCode: true }],
  },
  'alibaba-coding-plan': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 6,
    description:
      'Alibaba Cloud model studio coding plan (International / China)',
    authMethods: [{ type: 'api_key', promptLabel: 'Alibaba API Key' }],
  },
  'alibaba-token-plan': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 7,
    description: 'Alibaba Cloud token-based coding plan',
    authMethods: [{ type: 'api_key', promptLabel: 'Alibaba Token Plan Key' }],
  },
  'zhipu-coding-plan': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 8,
    description: 'Zhipu GLM coding plan via bigmodel.cn',
    authMethods: [
      { type: 'api_key', promptLabel: 'Zhipu API Key (id.secret)' },
    ],
  },
  'qwen-portal': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 9,
    description: 'Alibaba Qwen portal access',
    authMethods: [{ type: 'api_key' }],
  },
  'zai-coding-plan': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 10,
    description: 'Z.AI / GLM coding plan',
    authMethods: [{ type: 'oauth', port: 54548 }],
  },
  zai: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 38,
    description: 'Z.AI / GLM direct API key',
    authMethods: [{ type: 'api_key' }],
  },
  'opencode-go': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 11,
    description: 'OpenCode Go subscription plan',
    authMethods: [{ type: 'oauth' }],
  },
  'opencode-zen': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 12,
    description: 'OpenCode Zen subscription plan',
    authMethods: [{ type: 'oauth' }],
  },
  'gitlab-duo': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 13,
    description: 'GitLab Duo chat subscription',
    authMethods: [{ type: 'oauth' }],
  },
  'gitlab-duo-agent': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 14,
    description: 'GitLab Duo workflow agent',
    authMethods: [{ type: 'oauth' }],
  },
  devin: {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 15,
    description: 'Devin (Codeium) coding agent subscription',
    authMethods: [{ type: 'oauth' }],
  },
  antigravity: {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 16,
    description: 'Google Antigravity (Code Assist for partners)',
    authMethods: [{ type: 'oauth', port: 8085, pasteCode: true }],
  },
  'google-gemini-cli': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 17,
    description: 'Google Cloud Code Assist via PLUMB',
    authMethods: [{ type: 'oauth', port: 8085, pasteCode: true }],
  },
  umans: {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 18,
    description: 'Umans AI coding plan',
    authMethods: [{ type: 'api_key' }],
  },
  sakana: {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 19,
    description: 'Sakana AI coding plan',
    authMethods: [{ type: 'api_key' }],
  },
  'minimax-code-cn': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 20,
    description: 'MiniMax coding subscription (China)',
    authMethods: [{ type: 'oauth' }],
  },
  'xiaomi-token-plan-sgp': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 21,
    description: 'Xiaomi token-based coding plan',
    authMethods: [{ type: 'api_key' }],
  },
  'xiaomi-token-plan-ams': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 22,
    description: 'Xiaomi token-based coding plan',
    authMethods: [{ type: 'api_key' }],
  },
  'xiaomi-token-plan-cn': {
    category: PlumbProviderCategory.CODING_PLAN,
    group: 'Coding Plans',
    order: 23,
    description: 'Xiaomi token-based coding plan',
    authMethods: [{ type: 'api_key' }],
  },
  anthropic: {
    category: PlumbProviderCategory.OAUTH_ACCOUNT,
    group: 'OAuth Providers',
    order: 1,
    description:
      'Anthropic Claude API via OAuth (Claude Pro or Max subscription)',
    authMethods: [
      { type: 'oauth', port: 54545, pasteCode: true },
      { type: 'api_key', envVar: 'ANTHROPIC_API_KEY' },
    ],
  },
  'xai-oauth': {
    category: PlumbProviderCategory.OAUTH_ACCOUNT,
    group: 'OAuth Providers',
    order: 2,
    description: 'xAI Grok via OAuth account',
    authMethods: [{ type: 'oauth' }],
  },
  xiaomi: {
    category: PlumbProviderCategory.OAUTH_ACCOUNT,
    group: 'OAuth Providers',
    order: 3,
    description: 'Xiaomi MiMo via OAuth',
    authMethods: [{ type: 'oauth' }],
  },
  openai: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 1,
    description: 'OpenAI API (GPT models)',
    authMethods: [{ type: 'api_key', envVar: 'OPENAI_API_KEY' }],
  },
  'anthropic-api': {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 2,
    description: 'Direct Anthropic API key',
    authMethods: [{ type: 'api_key', envVar: 'ANTHROPIC_API_KEY' }],
  },
  google: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 3,
    description: 'Google Gemini API (direct API key)',
    authMethods: [{ type: 'api_key', envVar: 'GEMINI_API_KEY' }],
  },
  'google-vertex': {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 4,
    description: 'Google Vertex AI platform',
    authMethods: [
      {
        type: 'env',
        envVars: ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION'],
      },
      { type: 'api_key', envVar: 'GOOGLE_API_KEY' },
    ],
  },
  xai: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 5,
    description: 'xAI Grok API key',
    authMethods: [{ type: 'api_key', envVar: 'XAI_API_KEY' }],
  },
  deepseek: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 6,
    description: 'DeepSeek API',
    authMethods: [{ type: 'api_key', envVar: 'DEEPSEEK_API_KEY' }],
  },
  mistral: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 7,
    description: 'Mistral AI API',
    authMethods: [{ type: 'api_key', envVar: 'MISTRAL_API_KEY' }],
  },
  groq: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 8,
    description: 'Groq fast inference API',
    authMethods: [{ type: 'api_key', envVar: 'GROQ_API_KEY' }],
  },
  openrouter: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 9,
    description: 'OpenRouter multi-provider gateway',
    authMethods: [{ type: 'api_key', envVar: 'OPENROUTER_API_KEY' }],
  },
  fireworks: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 10,
    description: 'Fireworks AI inference platform',
    authMethods: [{ type: 'api_key', envVar: 'FIREWORKS_API_KEY' }],
  },
  together: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 11,
    description: 'Together AI inference platform',
    authMethods: [{ type: 'api_key', envVar: 'TOGETHER_API_KEY' }],
  },
  cerebras: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 12,
    description: 'Cerebras fast inference',
    authMethods: [{ type: 'api_key', envVar: 'CEREBRAS_API_KEY' }],
  },
  moonshot: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 13,
    description: 'Moonshot Kimi API',
    authMethods: [{ type: 'api_key', envVar: 'MOONSHOT_API_KEY' }],
  },
  meta: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 14,
    description: 'Meta AI API (Llama/Muse models)',
    authMethods: [{ type: 'api_key', envVar: 'META_API_KEY' }],
  },
  perplexity: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 15,
    description: 'Perplexity AI API',
    authMethods: [{ type: 'api_key', envVar: 'PERPLEXITY_API_KEY' }],
  },
  nvidia: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 16,
    description: 'NVIDIA NIM inference',
    authMethods: [{ type: 'api_key', envVar: 'NVIDIA_API_KEY' }],
  },
  novita: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 17,
    description: 'Novita AI inference',
    authMethods: [{ type: 'api_key', envVar: 'NOVITA_API_KEY' }],
  },
  huggingface: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 18,
    description: 'Hugging Face inference API',
    authMethods: [{ type: 'api_key', envVar: 'HF_TOKEN' }],
  },
  synthetic: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 19,
    description: 'Synthetic inference service',
    authMethods: [{ type: 'api_key' }],
  },
  nanogpt: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 20,
    description: 'NanoGPT API gateway',
    authMethods: [{ type: 'api_key' }],
  },
  venice: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 21,
    description: 'Venice AI privacy-focused inference',
    authMethods: [{ type: 'api_key', envVar: 'VENICE_API_KEY' }],
  },
  azure: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 22,
    description: 'Microsoft Azure OpenAI Service',
    authMethods: [
      {
        type: 'env',
        envVars: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT'],
      },
    ],
  },
  'amazon-bedrock': {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 23,
    description: 'AWS Bedrock managed inference',
    authMethods: [{ type: 'none' }],
  },
  aimlapi: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 24,
    description: 'AIML API multi-model access',
    authMethods: [{ type: 'api_key', envVar: 'AIML_API_KEY' }],
  },
  baseten: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 25,
    description: 'Baseten inference platform',
    authMethods: [{ type: 'api_key', envVar: 'BASETEN_API_KEY' }],
  },
  siliconflow: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 26,
    description: 'SiliconFlow inference platform',
    authMethods: [{ type: 'api_key', envVar: 'SILICONFLOW_API_KEY' }],
  },
  'siliconflow-cn': {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 27,
    description: 'SiliconFlow China inference',
    authMethods: [{ type: 'api_key', envVar: 'SILICONFLOW_API_KEY' }],
  },
  qianfan: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 28,
    description: 'Baidu Qianfan AI platform',
    authMethods: [{ type: 'api_key', envVar: 'QIANFAN_API_KEY' }],
  },
  coreweave: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 29,
    description: 'CoreWeave cloud inference',
    authMethods: [{ type: 'api_key', envVar: 'COREWEAVE_API_KEY' }],
  },
  'cloudflare-ai-gateway': {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 30,
    description: 'Cloudflare AI Gateway (proxy)',
    authMethods: [{ type: 'api_key', envVar: 'CLOUDFLARE_AI_GATEWAY_KEY' }],
  },
  'vercel-ai-gateway': {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 31,
    description: 'Vercel AI Gateway (proxy)',
    authMethods: [{ type: 'api_key', envVar: 'VERCEL_AI_GATEWAY_KEY' }],
  },
  litellm: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 32,
    description: 'LiteLLM proxy',
    authMethods: [{ type: 'api_key', envVar: 'LITELLM_API_KEY' }],
  },
  kilo: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 33,
    description: 'Kilo AI inference',
    authMethods: [{ type: 'api_key', envVar: 'KILO_API_KEY' }],
  },
  zenmux: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 34,
    description: 'ZenMux multi-model gateway',
    authMethods: [{ type: 'api_key' }],
  },
  minimax: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 35,
    description: 'MiniMax direct API key',
    authMethods: [{ type: 'api_key', envVar: 'MINIMAX_API_KEY' }],
  },
  firepass: {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 36,
    description: 'Firepass AI API',
    authMethods: [{ type: 'api_key' }],
  },
  'wafer-serverless': {
    category: PlumbProviderCategory.API_KEY,
    group: 'API Providers',
    order: 37,
    description: 'Wafer serverless inference',
    authMethods: [{ type: 'oauth' }],
  },
  ollama: {
    category: PlumbProviderCategory.LOCAL,
    group: 'Local Models',
    order: 1,
    description: 'Local Ollama server (OpenAI-compatible)',
    authMethods: [{ type: 'none' }],
  },
  'ollama-cloud': {
    category: PlumbProviderCategory.LOCAL,
    group: 'Local Models',
    order: 2,
    description: 'Ollama cloud-hosted models',
    authMethods: [{ type: 'api_key' }],
  },
  'lm-studio': {
    category: PlumbProviderCategory.LOCAL,
    group: 'Local Models',
    order: 3,
    description: 'LM Studio local inference server (OpenAI-compatible)',
    authMethods: [{ type: 'none' }],
  },
  'llama-cpp': {
    category: PlumbProviderCategory.LOCAL,
    group: 'Local Models',
    order: 4,
    description: 'llama.cpp local server (OpenAI-compatible)',
    authMethods: [{ type: 'none' }],
  },
  vllm: {
    category: PlumbProviderCategory.LOCAL,
    group: 'Local Models',
    order: 5,
    description: 'vLLM local server (OpenAI-compatible)',
    authMethods: [{ type: 'none' }],
  },
  'custom-openai-compat': {
    category: PlumbProviderCategory.CUSTOM_ENDPOINT,
    group: 'Custom',
    order: 1,
    description: 'Any OpenAI-compatible API endpoint',
    authMethods: [
      { type: 'api_key', promptLabel: 'API Key (optional)' },
      { type: 'none' },
    ],
  },
  'google-login': {
    category: PlumbProviderCategory.OAUTH_ACCOUNT,
    group: 'Google',
    order: 99,
    description: 'Login with Google account (Gemini Code Assist)',
    authMethods: [{ type: 'oauth' }],
  },
};

// ─── OMP → PLUMB projection ────────────────────────────────────────────

/**
 * Resolve the OMP backing for a PLUMB presentation id. Returns the OMP
 * provider id (possibly aliased) or null for PLUMB-only synthetics.
 */
function resolveOmpId(plumbId: string): string | null {
  if (PLUMB_SYNTHETIC_IDS.has(plumbId)) return null;
  return PLUMB_TO_OMP_ID[plumbId] ?? plumbId;
}

/** Derive availability from the OMP runtime: registry + catalog signals. */
function isOmpAvailable(ompId: string, plumbId?: string): boolean {
  // Providers whose OAuth client registration is upstream-owned and invalid
  // for PLUMB must not be available as OAuth login flows.
  if (plumbId && BLOCKED_CLIENT_REGISTRATIONS.has(plumbId)) return false;
  // Providers with no OMP catalog descriptor and therefore no model source.
  if (plumbId && BLOCKED_NO_MODEL_SOURCE.has(plumbId)) return false;
  const def = getProviderDefinition(ompId);
  if (def) {
    if (def.available === false) return false;
    // Loginable providers are available by definition of having a flow.
    if (typeof def.login === 'function') return true;
  }
  const entry = getCatalogProviderEntry(ompId);
  if (entry) {
    // A runtime model-manager factory (or allow-unauthenticated) means the
    // provider can actually serve models.
    if (typeof entry.createModelManagerOptions === 'function') return true;
    if (entry.allowUnauthenticated === true) return true;
    return typeof entry.defaultModel === 'string';
  }
  // No OMP backing at all → not available through the OMP authority.
  return false;
}

/** Project a PLUMB presentation id onto a `PlumbProvider`. */
function projectProvider(plumbId: string): PlumbProvider | undefined {
  const presentation = PRESENTATION[plumbId];
  const ompId = resolveOmpId(plumbId);
  const ompDef: ProviderDefinition | undefined = ompId
    ? getProviderDefinition(ompId)
    : undefined;
  const catalogEntry = ompId ? getCatalogProviderEntry(ompId) : undefined;

  const name =
    ompDef?.name ??
    catalogEntry?.catalogDiscovery?.label ??
    presentation?.description ??
    plumbId;
  // Availability is an OMP-runtime signal. PLUMB-only synthetics have no OMP
  // descriptor and are therefore not selectable in the OMP-derived inventory
  // (they remain resolvable via ALL_PROVIDERS / getPlumbProvider).
  const available =
    presentation === undefined
      ? false
      : ompId === null
        ? false
        : isOmpAvailable(ompId, plumbId);

  const envVars: string[] = catalogEntry?.envVars
    ? [...catalogEntry.envVars]
    : plumbEnvVars(plumbId);

  const allowUnauthenticated = catalogEntry
    ? (catalogEntry.allowUnauthenticated ?? false)
    : undefined;

  const provider: PlumbProvider = {
    id: plumbId,
    name,
    category: presentation?.category ?? PlumbProviderCategory.API_KEY,
    description: presentation?.description,
    authMethods: presentation?.authMethods ?? defaultAuthMethods(ompDef),
    defaultModel: catalogEntry?.defaultModel,
    envVars: envVars.length > 0 ? envVars : undefined,
    available,
    allowUnauthenticated,
    group: presentation?.group,
    order: presentation?.order,
  };
  if (provider.defaultModel === undefined) {
    delete (provider as { defaultModel?: string }).defaultModel;
  }
  if (provider.allowUnauthenticated === undefined) {
    delete (provider as { allowUnauthenticated?: boolean })
      .allowUnauthenticated;
  }
  if (provider.envVars === undefined) {
    delete (provider as { envVars?: string[] }).envVars;
  }
  return provider;
}

/** PLUMB-only env vars for synthetic/alias providers. */
function plumbEnvVars(plumbId: string): string[] {
  switch (plumbId) {
    case 'openai':
      return ['OPENAI_API_KEY'];
    case 'anthropic-api':
    case 'anthropic':
      return ['ANTHROPIC_API_KEY', 'ANTHROPIC_OAUTH_TOKEN'];
    case 'google':
      return ['GEMINI_API_KEY', 'GOOGLE_API_KEY'];
    case 'google-vertex':
      return [
        'GOOGLE_CLOUD_PROJECT',
        'GOOGLE_CLOUD_LOCATION',
        'GOOGLE_API_KEY',
      ];
    case 'ollama':
      return ['OLLAMA_BASE_URL'];
    case 'lm-studio':
      return ['LM_STUDIO_BASE_URL'];
    case 'llama-cpp':
      return ['LLAMA_CPP_API_KEY', 'LLAMA_CPP_BASE_URL'];
    default:
      return [];
  }
}

/** Default auth methods derived from the OMP definition when no overlay. */
function defaultAuthMethods(
  def: ProviderDefinition | undefined,
): PlumbAuthMethod[] {
  if (!def) return [{ type: 'none' }];
  const methods: PlumbAuthMethod[] = [];
  if (typeof def.login === 'function') {
    methods.push({
      type: 'oauth',
      ...(def.callbackPort ? { port: def.callbackPort } : {}),
      ...(def.pasteCodeFlow ? { pasteCode: true } : {}),
    });
  }
  if (def.envKeys) {
    methods.push({ type: 'api_key' });
  }
  if (methods.length === 0) methods.push({ type: 'none' });
  return methods;
}

// ─── Catalog exports ───────────────────────────────────────────────────

/** Complete provider catalog: OMP-backed ids + PLUMB-only synthetics. */
export const PLUMB_PROVIDERS: readonly PlumbProvider[] = buildProviders();

function buildProviders(): PlumbProvider[] {
  const providers: PlumbProvider[] = [];
  const seen = new Set<string>();

  // Iterate the PLUMB presentation ids (the UI surface), projecting each from
  // its OMP backing. This preserves PLUMB-only splits (e.g. `anthropic` /
  // `anthropic-api` both backed by the single OMP `anthropic` def) and
  // PLUMB-only synthetics, while the authoritative fields come from OMP.
  for (const plumbId of Object.keys(PRESENTATION)) {
    if (seen.has(plumbId)) continue;
    const projected = projectProvider(plumbId);
    if (!projected) continue;
    seen.add(plumbId);
    providers.push(projected);
  }
  return providers;
}

/** Providers the OMP authority deems available (selectable in the UI). */
export const SELECTABLE_PROVIDERS: readonly PlumbProvider[] =
  PLUMB_PROVIDERS.filter((p) => p.available);

/** The set of selectable provider ids (derived, not hand-maintained). */
export const PRODUCTION_READY_PROVIDER_IDS: ReadonlySet<string> = new Set(
  SELECTABLE_PROVIDERS.map((p) => p.id),
);

/** All providers including unavailable (for reference only). */
export const ALL_PROVIDERS: readonly PlumbProvider[] = PLUMB_PROVIDERS;

// ─── Index helpers ────────────────────────────────────────────────────

const PROVIDER_BY_ID = new Map<string, PlumbProvider>(
  ALL_PROVIDERS.map((p) => [p.id, p]),
);

/** Look up a provider by its ID (selectable or not). */
export function getPlumbProvider(id: string): PlumbProvider | undefined {
  return PROVIDER_BY_ID.get(id);
}

/** Get all providers in a given category (selectable only). */
export function getProvidersByCategory(
  category: PlumbProviderCategory,
): PlumbProvider[] {
  return SELECTABLE_PROVIDERS.filter((p) => p.category === category).sort(
    (a, b) => (a.order ?? 99) - (b.order ?? 99),
  );
}

/** Get all providers grouped by category for first-run setup display. */
export function getProviderSetupGroups(): Map<string, PlumbProvider[]> {
  const groups = new Map<string, PlumbProvider[]>();
  for (const provider of SELECTABLE_PROVIDERS) {
    const group = provider.group ?? 'Other';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(provider);
  }
  return groups;
}

/** All coding plan / subscription providers (selectable only). */
export const CODING_PLAN_PROVIDERS = SELECTABLE_PROVIDERS.filter(
  (p) => p.category === PlumbProviderCategory.CODING_PLAN,
);

/** All OAuth account providers (selectable only). */
export const OAUTH_PROVIDERS = SELECTABLE_PROVIDERS.filter(
  (p) =>
    p.category === PlumbProviderCategory.OAUTH_ACCOUNT &&
    p.authMethods.some((m) => m.type === 'oauth'),
);

/** All API key providers (selectable only). */
export const API_KEY_PROVIDERS = SELECTABLE_PROVIDERS.filter(
  (p) => p.category === PlumbProviderCategory.API_KEY,
);

/** All local / keyless providers (selectable only). */
export const LOCAL_PROVIDERS = SELECTABLE_PROVIDERS.filter(
  (p) => p.category === PlumbProviderCategory.LOCAL,
);

/** Providers that can be used without authentication. */
export const UNAUTHENTICATED_PROVIDERS = SELECTABLE_PROVIDERS.filter(
  (p) => p.allowUnauthenticated === true,
);

/** OMP registry ids backing the PLUMB catalog (for governance/audit). */
export function getOmpRegistryIds(): ReadonlySet<string> {
  return OMP_REGISTRY_IDS;
}

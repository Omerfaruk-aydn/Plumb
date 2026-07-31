/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * OMP-derived provider catalog. Every provider from the pinned OMP source
 * (SHA: 4df68d60438423b384b2b47fb3d6835641624757) is represented.
 * Upstream source: https://github.com/can1357/oh-my-pi.git
 * Upstream source: packages/catalog/src/provider-models/descriptors.ts
 * Upstream source: packages/ai/src/registry/registry.ts
 * Upstream license: MIT (c) 2025 Mario Zechner, (c) 2025-2026 Can Bölük
 */

import {
  type PlumbProvider,
  PlumbProviderCategory,
  type PlumbAuthMethod,
} from './types.js';

// ─── Provider definitions ────────────────────────────────────────────

/** Complete provider catalog derived from OMP upstream. */
export const PLUMB_PROVIDERS: readonly PlumbProvider[] = [
  // ── CODING PLANS AND SUBSCRIPTIONS ───────────────────────────────

  {
    id: 'openai-codex',
    name: 'ChatGPT Plus/Pro (Codex)',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'OpenAI Codex subscription via ChatGPT Plus or Pro',
    authMethods: [
      { type: 'oauth', port: 1455, pasteCode: true },
      { type: 'device_code' },
    ],
    defaultModel: 'gpt-5.5',
    envVars: ['OPENAI_API_KEY'],
    available: true,
    group: 'Coding Plans',
    order: 1,
  },

  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'GitHub Copilot subscription',
    authMethods: [{ type: 'oauth', pasteCode: true }],
    defaultModel: 'gpt-5.5',
    available: true,
    group: 'Coding Plans',
    order: 2,
  },

  {
    id: 'cursor',
    name: 'Cursor',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Cursor IDE subscription',
    authMethods: [{ type: 'oauth', pasteCode: true }],
    defaultModel: 'claude-4.6-opus-high',
    available: true,
    group: 'Coding Plans',
    order: 3,
  },

  {
    id: 'kimi-code',
    name: 'Kimi Code',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Moonshot Kimi coding plan',
    authMethods: [{ type: 'oauth', pasteCode: true }],
    defaultModel: 'kimi-for-coding',
    available: true,
    group: 'Coding Plans',
    order: 4,
  },

  {
    id: 'minimax-code',
    name: 'MiniMax Coding Plan',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'MiniMax coding subscription',
    authMethods: [{ type: 'oauth', pasteCode: true }],
    defaultModel: 'MiniMax-M3',
    available: true,
    group: 'Coding Plans',
    order: 5,
  },

  {
    id: 'alibaba-coding-plan',
    name: 'Alibaba Coding Plan',
    category: PlumbProviderCategory.CODING_PLAN,
    description:
      'Alibaba Cloud model studio coding plan (International / China)',
    authMethods: [{ type: 'api_key', promptLabel: 'Alibaba API Key' }],
    defaultModel: 'qwen3.7-plus',
    envVars: ['ALIBABA_API_KEY'],
    available: true,
    group: 'Coding Plans',
    order: 6,
  },

  {
    id: 'alibaba-token-plan',
    name: 'Alibaba Token Plan',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Alibaba Cloud token-based coding plan',
    authMethods: [{ type: 'api_key', promptLabel: 'Alibaba Token Plan Key' }],
    defaultModel: 'qwen3.7-plus',
    envVars: ['ALIBABA_TOKEN_PLAN_KEY'],
    available: true,
    group: 'Coding Plans',
    order: 7,
  },

  {
    id: 'zhipu-coding-plan',
    name: 'Zhipu Coding Plan (智谱)',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Zhipu GLM coding plan via bigmodel.cn',
    authMethods: [
      { type: 'api_key', promptLabel: 'Zhipu API Key (id.secret)' },
    ],
    defaultModel: 'glm-5.1',
    available: true,
    group: 'Coding Plans',
    order: 8,
  },

  {
    id: 'qwen-portal',
    name: 'Qwen Portal',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Alibaba Qwen portal access',
    authMethods: [{ type: 'api_key' }],
    defaultModel: 'coder-model',
    available: true,
    group: 'Coding Plans',
    order: 9,
  },

  {
    id: 'zai-coding-plan',
    name: 'Z.AI Coding Plan',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Z.AI / GLM coding plan',
    authMethods: [{ type: 'oauth', port: 54548 }],
    defaultModel: 'glm-5.2',
    available: true,
    group: 'Coding Plans',
    order: 10,
  },

  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'OpenCode Go subscription plan',
    authMethods: [{ type: 'oauth' }],
    defaultModel: 'kimi-k2.7-code',
    available: true,
    group: 'Coding Plans',
    order: 11,
  },

  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'OpenCode Zen subscription plan',
    authMethods: [{ type: 'oauth' }],
    defaultModel: 'claude-opus-4-8',
    available: true,
    group: 'Coding Plans',
    order: 12,
  },

  {
    id: 'gitlab-duo',
    name: 'GitLab Duo',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'GitLab Duo chat subscription',
    authMethods: [{ type: 'oauth' }],
    defaultModel: 'duo-chat-opus-4-6',
    available: true,
    group: 'Coding Plans',
    order: 13,
  },

  {
    id: 'gitlab-duo-agent',
    name: 'GitLab Duo Workflow',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'GitLab Duo workflow agent',
    authMethods: [{ type: 'oauth' }],
    defaultModel: 'claude_sonnet_4_6_vertex',
    available: true,
    group: 'Coding Plans',
    order: 14,
  },

  {
    id: 'devin',
    name: 'Devin',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Devin (Codeium) coding agent subscription',
    authMethods: [{ type: 'oauth' }],
    defaultModel: 'swe-1-6',
    available: true,
    group: 'Coding Plans',
    order: 15,
  },

  {
    id: 'antigravity',
    name: 'Google Antigravity',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Google Antigravity (Code Assist for partners)',
    authMethods: [{ type: 'oauth', port: 8085, pasteCode: true }],
    defaultModel: 'gemini-3.1-pro',
    available: true,
    group: 'Coding Plans',
    order: 16,
  },

  {
    id: 'google-gemini-cli',
    name: 'Gemini CLI (Cloud Code Assist)',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Google Cloud Code Assist via Gemini CLI',
    authMethods: [{ type: 'oauth', port: 8085, pasteCode: true }],
    defaultModel: 'gemini-3.1-pro-preview',
    available: true,
    group: 'Coding Plans',
    order: 17,
  },

  {
    id: 'umans',
    name: 'Umans Coding Plan',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Umans AI coding plan',
    authMethods: [{ type: 'api_key' }],
    defaultModel: 'umans-coder',
    available: true,
    group: 'Coding Plans',
    order: 18,
  },

  {
    id: 'sakana',
    name: 'Sakana',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Sakana AI coding plan',
    authMethods: [{ type: 'api_key' }],
    defaultModel: 'fugu',
    available: true,
    group: 'Coding Plans',
    order: 19,
  },

  {
    id: 'minimax-code-cn',
    name: 'MiniMax Coding Plan (CN)',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'MiniMax coding subscription (China)',
    authMethods: [{ type: 'oauth' }],
    defaultModel: 'MiniMax-M3',
    available: true,
    group: 'Coding Plans',
    order: 20,
  },

  {
    id: 'xiaomi-token-plan-sgp',
    name: 'Xiaomi Token Plan (Singapore)',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Xiaomi token-based coding plan',
    authMethods: [{ type: 'api_key' }],
    defaultModel: 'mimo-v2.5',
    available: true,
    group: 'Coding Plans',
    order: 21,
  },

  {
    id: 'xiaomi-token-plan-ams',
    name: 'Xiaomi Token Plan (Amsterdam)',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Xiaomi token-based coding plan',
    authMethods: [{ type: 'api_key' }],
    defaultModel: 'mimo-v2.5',
    available: true,
    group: 'Coding Plans',
    order: 22,
  },

  {
    id: 'xiaomi-token-plan-cn',
    name: 'Xiaomi Token Plan (China)',
    category: PlumbProviderCategory.CODING_PLAN,
    description: 'Xiaomi token-based coding plan',
    authMethods: [{ type: 'api_key' }],
    defaultModel: 'mimo-v2.5',
    available: true,
    group: 'Coding Plans',
    order: 23,
  },

  // ── OAUTH ACCOUNT PROVIDERS ──────────────────────────────────────

  {
    id: 'anthropic',
    name: 'Anthropic (Claude Pro/Max)',
    category: PlumbProviderCategory.OAUTH_ACCOUNT,
    description:
      'Anthropic Claude API via OAuth (Claude Pro or Max subscription)',
    authMethods: [
      { type: 'oauth', port: 54545, pasteCode: true },
      { type: 'api_key', envVar: 'ANTHROPIC_API_KEY' },
    ],
    defaultModel: 'claude-opus-4-8',
    envVars: ['ANTHROPIC_API_KEY', 'ANTHROPIC_OAUTH_TOKEN'],
    available: true,
    group: 'OAuth Providers',
    order: 1,
  },

  {
    id: 'xai-oauth',
    name: 'xAI (Grok OAuth)',
    category: PlumbProviderCategory.OAUTH_ACCOUNT,
    description: 'xAI Grok via OAuth account',
    authMethods: [{ type: 'oauth' }],
    defaultModel: 'grok-4.3',
    available: true,
    group: 'OAuth Providers',
    order: 2,
  },

  {
    id: 'xiaomi',
    name: 'Xiaomi',
    category: PlumbProviderCategory.OAUTH_ACCOUNT,
    description: 'Xiaomi MiMo via OAuth',
    authMethods: [{ type: 'oauth' }],
    defaultModel: 'mimo-v2.5',
    available: true,
    group: 'OAuth Providers',
    order: 3,
  },

  // ── API KEY PROVIDERS ────────────────────────────────────────────

  {
    id: 'openai',
    name: 'OpenAI',
    category: PlumbProviderCategory.API_KEY,
    description: 'OpenAI API (GPT models)',
    authMethods: [{ type: 'api_key', envVar: 'OPENAI_API_KEY' }],
    defaultModel: 'gpt-5.5',
    envVars: ['OPENAI_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 1,
  },

  {
    id: 'anthropic-api',
    name: 'Anthropic API',
    category: PlumbProviderCategory.API_KEY,
    description: 'Direct Anthropic API key',
    authMethods: [{ type: 'api_key', envVar: 'ANTHROPIC_API_KEY' }],
    defaultModel: 'claude-opus-4-8',
    envVars: ['ANTHROPIC_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 2,
    // Note: provider id for API-key-only Anthropic is 'anthropic' which also
    // supports OAuth; the category split is for UI grouping only.
    // We use the same provider id 'anthropic' for both auth methods.
  },

  {
    id: 'google',
    name: 'Google Gemini API',
    category: PlumbProviderCategory.API_KEY,
    description: 'Google Gemini API (direct API key)',
    authMethods: [{ type: 'api_key', envVar: 'GEMINI_API_KEY' }],
    defaultModel: 'gemini-3.1-pro-preview',
    envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 3,
  },

  {
    id: 'google-vertex',
    name: 'Google Vertex AI',
    category: PlumbProviderCategory.API_KEY,
    description: 'Google Vertex AI platform',
    authMethods: [
      {
        type: 'env',
        envVars: ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION'],
      },
      { type: 'api_key', envVar: 'GOOGLE_API_KEY' },
    ],
    defaultModel: 'gemini-3.1-pro-preview',
    envVars: [
      'GOOGLE_CLOUD_PROJECT',
      'GOOGLE_CLOUD_LOCATION',
      'GOOGLE_API_KEY',
    ],
    available: true,
    group: 'API Providers',
    order: 4,
  },

  {
    id: 'xai',
    name: 'xAI (Grok API)',
    category: PlumbProviderCategory.API_KEY,
    description: 'xAI Grok API key',
    authMethods: [{ type: 'api_key', envVar: 'XAI_API_KEY' }],
    defaultModel: 'grok-4-fast-non-reasoning',
    envVars: ['XAI_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 5,
  },

  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: PlumbProviderCategory.API_KEY,
    description: 'DeepSeek API',
    authMethods: [{ type: 'api_key', envVar: 'DEEPSEEK_API_KEY' }],
    defaultModel: 'deepseek-v4-pro',
    envVars: ['DEEPSEEK_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 6,
  },

  {
    id: 'mistral',
    name: 'Mistral',
    category: PlumbProviderCategory.API_KEY,
    description: 'Mistral AI API',
    authMethods: [{ type: 'api_key', envVar: 'MISTRAL_API_KEY' }],
    defaultModel: 'devstral-medium-latest',
    envVars: ['MISTRAL_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 7,
  },

  {
    id: 'groq',
    name: 'Groq',
    category: PlumbProviderCategory.API_KEY,
    description: 'Groq fast inference API',
    authMethods: [{ type: 'api_key', envVar: 'GROQ_API_KEY' }],
    defaultModel: 'openai/gpt-oss-120b',
    envVars: ['GROQ_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 8,
  },

  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: PlumbProviderCategory.API_KEY,
    description: 'OpenRouter multi-provider gateway',
    authMethods: [{ type: 'api_key', envVar: 'OPENROUTER_API_KEY' }],
    defaultModel: 'openai/gpt-5.5',
    envVars: ['OPENROUTER_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 9,
  },

  {
    id: 'fireworks',
    name: 'Fireworks AI',
    category: PlumbProviderCategory.API_KEY,
    description: 'Fireworks AI inference platform',
    authMethods: [{ type: 'api_key', envVar: 'FIREWORKS_API_KEY' }],
    defaultModel: 'kimi-k2.7-code',
    envVars: ['FIREWORKS_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 10,
  },

  {
    id: 'together',
    name: 'Together AI',
    category: PlumbProviderCategory.API_KEY,
    description: 'Together AI inference platform',
    authMethods: [{ type: 'api_key', envVar: 'TOGETHER_API_KEY' }],
    defaultModel: 'moonshotai/Kimi-K2.7-Code',
    envVars: ['TOGETHER_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 11,
  },

  {
    id: 'cerebras',
    name: 'Cerebras',
    category: PlumbProviderCategory.API_KEY,
    description: 'Cerebras fast inference',
    authMethods: [{ type: 'api_key', envVar: 'CEREBRAS_API_KEY' }],
    defaultModel: 'zai-glm-4.7',
    envVars: ['CEREBRAS_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 12,
  },

  {
    id: 'moonshot',
    name: 'Moonshot AI',
    category: PlumbProviderCategory.API_KEY,
    description: 'Moonshot Kimi API',
    authMethods: [{ type: 'api_key', envVar: 'MOONSHOT_API_KEY' }],
    defaultModel: 'kimi-k2.7-code',
    envVars: ['MOONSHOT_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 13,
  },

  {
    id: 'meta',
    name: 'Meta',
    category: PlumbProviderCategory.API_KEY,
    description: 'Meta AI API (Llama/Muse models)',
    authMethods: [{ type: 'api_key', envVar: 'META_API_KEY' }],
    defaultModel: 'muse-spark-1.1',
    envVars: ['META_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 14,
  },

  {
    id: 'perplexity',
    name: 'Perplexity',
    category: PlumbProviderCategory.API_KEY,
    description: 'Perplexity AI API',
    authMethods: [{ type: 'api_key', envVar: 'PERPLEXITY_API_KEY' }],
    available: true,
    group: 'API Providers',
    order: 15,
  },

  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    category: PlumbProviderCategory.API_KEY,
    description: 'NVIDIA NIM inference',
    authMethods: [{ type: 'api_key', envVar: 'NVIDIA_API_KEY' }],
    defaultModel: 'nvidia/llama-3.1-nemotron-70b-instruct',
    envVars: ['NVIDIA_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 16,
  },

  {
    id: 'novita',
    name: 'Novita AI',
    category: PlumbProviderCategory.API_KEY,
    description: 'Novita AI inference',
    authMethods: [{ type: 'api_key', envVar: 'NOVITA_API_KEY' }],
    defaultModel: 'moonshotai/kimi-k2.7-code',
    envVars: ['NOVITA_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 17,
  },

  {
    id: 'huggingface',
    name: 'Hugging Face',
    category: PlumbProviderCategory.API_KEY,
    description: 'Hugging Face inference API',
    authMethods: [{ type: 'api_key', envVar: 'HF_TOKEN' }],
    defaultModel: 'deepseek-ai/DeepSeek-R1',
    envVars: ['HF_TOKEN'],
    available: true,
    group: 'API Providers',
    order: 18,
  },

  {
    id: 'synthetic',
    name: 'Synthetic',
    category: PlumbProviderCategory.API_KEY,
    description: 'Synthetic inference service',
    authMethods: [{ type: 'api_key' }],
    defaultModel: 'hf:zai-org/GLM-5.1',
    available: true,
    group: 'API Providers',
    order: 19,
  },

  {
    id: 'nanogpt',
    name: 'NanoGPT',
    category: PlumbProviderCategory.API_KEY,
    description: 'NanoGPT API gateway',
    authMethods: [{ type: 'api_key' }],
    defaultModel: 'openai/gpt-5.5',
    available: true,
    group: 'API Providers',
    order: 20,
  },

  {
    id: 'venice',
    name: 'Venice AI',
    category: PlumbProviderCategory.API_KEY,
    description: 'Venice AI privacy-focused inference',
    authMethods: [{ type: 'api_key', envVar: 'VENICE_API_KEY' }],
    defaultModel: 'llama-3.3-70b',
    envVars: ['VENICE_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 21,
  },

  {
    id: 'azure',
    name: 'Azure OpenAI',
    category: PlumbProviderCategory.API_KEY,
    description: 'Microsoft Azure OpenAI Service',
    authMethods: [
      {
        type: 'env',
        envVars: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT'],
      },
    ],
    defaultModel: 'gpt-5.5',
    envVars: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT'],
    available: true,
    group: 'API Providers',
    order: 22,
  },

  {
    id: 'amazon-bedrock',
    name: 'Amazon Bedrock',
    category: PlumbProviderCategory.API_KEY,
    description: 'AWS Bedrock managed inference',
    authMethods: [{ type: 'none' }], // Uses AWS credential chain
    defaultModel: 'us.anthropic.claude-opus-4-8',
    envVars: ['AWS_PROFILE', 'AWS_REGION'],
    available: true,
    allowUnauthenticated: true,
    group: 'API Providers',
    order: 23,
  },

  {
    id: 'aimlapi',
    name: 'AIML API',
    category: PlumbProviderCategory.API_KEY,
    description: 'AIML API multi-model access',
    authMethods: [{ type: 'api_key', envVar: 'AIML_API_KEY' }],
    defaultModel: 'gpt-5.5-2026-04-23',
    envVars: ['AIML_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 24,
  },

  {
    id: 'baseten',
    name: 'Baseten',
    category: PlumbProviderCategory.API_KEY,
    description: 'Baseten inference platform',
    authMethods: [{ type: 'api_key', envVar: 'BASETEN_API_KEY' }],
    defaultModel: 'moonshotai/Kimi-K2.7-Code',
    envVars: ['BASETEN_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 25,
  },

  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    category: PlumbProviderCategory.API_KEY,
    description: 'SiliconFlow inference platform',
    authMethods: [{ type: 'api_key', envVar: 'SILICONFLOW_API_KEY' }],
    defaultModel: 'zai-org/GLM-5.1',
    envVars: ['SILICONFLOW_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 26,
  },

  {
    id: 'siliconflow-cn',
    name: 'SiliconFlow (China)',
    category: PlumbProviderCategory.API_KEY,
    description: 'SiliconFlow China inference',
    authMethods: [{ type: 'api_key', envVar: 'SILICONFLOW_API_KEY' }],
    defaultModel: 'deepseek-ai/DeepSeek-V4-Pro',
    envVars: ['SILICONFLOW_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 27,
  },

  {
    id: 'qianfan',
    name: 'Qianfan (Baidu)',
    category: PlumbProviderCategory.API_KEY,
    description: 'Baidu Qianfan AI platform',
    authMethods: [{ type: 'api_key', envVar: 'QIANFAN_API_KEY' }],
    defaultModel: 'deepseek-v3.2',
    envVars: ['QIANFAN_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 28,
  },

  {
    id: 'coreweave',
    name: 'CoreWeave',
    category: PlumbProviderCategory.API_KEY,
    description: 'CoreWeave cloud inference',
    authMethods: [{ type: 'api_key', envVar: 'COREWEAVE_API_KEY' }],
    defaultModel: 'openai/gpt-oss-120b',
    envVars: ['COREWEAVE_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 29,
  },

  {
    id: 'cloudflare-ai-gateway',
    name: 'Cloudflare AI Gateway',
    category: PlumbProviderCategory.API_KEY,
    description: 'Cloudflare AI Gateway (proxy)',
    authMethods: [{ type: 'api_key', envVar: 'CLOUDFLARE_AI_GATEWAY_KEY' }],
    defaultModel: 'anthropic/claude-opus-4-8',
    envVars: ['CLOUDFLARE_AI_GATEWAY_KEY'],
    available: true,
    group: 'API Providers',
    order: 30,
  },

  {
    id: 'vercel-ai-gateway',
    name: 'Vercel AI Gateway',
    category: PlumbProviderCategory.API_KEY,
    description: 'Vercel AI Gateway (proxy)',
    authMethods: [{ type: 'api_key', envVar: 'VERCEL_AI_GATEWAY_KEY' }],
    defaultModel: 'anthropic/claude-opus-4-8',
    envVars: ['VERCEL_AI_GATEWAY_KEY'],
    available: true,
    group: 'API Providers',
    order: 31,
  },

  {
    id: 'litellm',
    name: 'LiteLLM',
    category: PlumbProviderCategory.API_KEY,
    description: 'LiteLLM proxy',
    authMethods: [{ type: 'api_key', envVar: 'LITELLM_API_KEY' }],
    defaultModel: 'claude-opus-4-8',
    envVars: ['LITELLM_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 32,
  },

  {
    id: 'kilo',
    name: 'Kilo',
    category: PlumbProviderCategory.API_KEY,
    description: 'Kilo AI inference',
    authMethods: [{ type: 'api_key', envVar: 'KILO_API_KEY' }],
    defaultModel: 'anthropic/claude-opus-4.8',
    envVars: ['KILO_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 33,
  },

  {
    id: 'zenmux',
    name: 'ZenMux',
    category: PlumbProviderCategory.API_KEY,
    description: 'ZenMux multi-model gateway',
    authMethods: [{ type: 'api_key' }],
    defaultModel: 'anthropic/claude-opus-4.8',
    available: true,
    group: 'API Providers',
    order: 34,
  },

  {
    id: 'minimax',
    name: 'MiniMax API',
    category: PlumbProviderCategory.API_KEY,
    description: 'MiniMax direct API key',
    authMethods: [{ type: 'api_key', envVar: 'MINIMAX_API_KEY' }],
    defaultModel: 'MiniMax-M3',
    envVars: ['MINIMAX_API_KEY'],
    available: true,
    group: 'API Providers',
    order: 35,
  },

  {
    id: 'firepass',
    name: 'Firepass',
    category: PlumbProviderCategory.API_KEY,
    description: 'Firepass AI API',
    authMethods: [{ type: 'api_key' }],
    defaultModel: 'kimi-k2.6-turbo',
    available: true,
    group: 'API Providers',
    order: 36,
  },

  {
    id: 'wafer-serverless',
    name: 'Wafer Serverless',
    category: PlumbProviderCategory.API_KEY,
    description: 'Wafer serverless inference',
    authMethods: [{ type: 'oauth' }],
    defaultModel: 'GLM-5.1',
    available: true,
    group: 'API Providers',
    order: 37,
  },

  // ── LOCAL / KEYLESS PROVIDERS ────────────────────────────────────

  {
    id: 'ollama',
    name: 'Ollama (Local)',
    category: PlumbProviderCategory.LOCAL,
    description: 'Local Ollama server (OpenAI-compatible)',
    authMethods: [{ type: 'none' }],
    defaultModel: 'gpt-oss:20b',
    envVars: ['OLLAMA_BASE_URL'],
    available: true,
    allowUnauthenticated: true,
    group: 'Local Models',
    order: 1,
  },

  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    category: PlumbProviderCategory.LOCAL,
    description: 'Ollama cloud-hosted models',
    authMethods: [{ type: 'api_key' }],
    defaultModel: 'gpt-oss:120b',
    available: true,
    group: 'Local Models',
    order: 2,
  },

  {
    id: 'lm-studio',
    name: 'LM Studio (Local)',
    category: PlumbProviderCategory.LOCAL,
    description: 'LM Studio local inference server (OpenAI-compatible)',
    authMethods: [{ type: 'none' }],
    defaultModel: 'llama-3-8b',
    envVars: ['LM_STUDIO_BASE_URL'],
    available: true,
    allowUnauthenticated: true,
    group: 'Local Models',
    order: 3,
  },

  {
    id: 'llama-cpp',
    name: 'llama.cpp (Local)',
    category: PlumbProviderCategory.LOCAL,
    description: 'llama.cpp local server (OpenAI-compatible)',
    authMethods: [{ type: 'none' }],
    envVars: ['LLAMA_CPP_API_KEY', 'LLAMA_CPP_BASE_URL'],
    available: true,
    allowUnauthenticated: true,
    group: 'Local Models',
    order: 4,
  },

  {
    id: 'vllm',
    name: 'vLLM (Local)',
    category: PlumbProviderCategory.LOCAL,
    description: 'vLLM local server (OpenAI-compatible)',
    authMethods: [{ type: 'none' }],
    defaultModel: 'gpt-oss-20b',
    available: true,
    allowUnauthenticated: true,
    group: 'Local Models',
    order: 5,
  },

  // ── CUSTOM ENDPOINT ──────────────────────────────────────────────

  {
    id: 'custom-openai-compat',
    name: 'Custom OpenAI-Compatible Endpoint',
    category: PlumbProviderCategory.CUSTOM_ENDPOINT,
    description: 'Any OpenAI-compatible API endpoint',
    authMethods: [
      { type: 'api_key', promptLabel: 'API Key (optional)' },
      { type: 'none' },
    ],
    available: true,
    allowUnauthenticated: true,
    group: 'Custom',
    order: 1,
  },

  // ── GOOGLE LOGIN (LEGACY / OPTIONAL) ─────────────────────────────

  {
    id: 'google-login',
    name: 'Google Login (OAuth)',
    category: PlumbProviderCategory.OAUTH_ACCOUNT,
    description: 'Login with Google account (Gemini Code Assist)',
    authMethods: [{ type: 'oauth' }],
    defaultModel: 'gemini-2.5-pro',
    available: true,
    group: 'Google',
    order: 99,
  },
];

// ─── Production-ready filter ───────────────────────────────────────────

/**
 * Only these provider IDs are production-ready and selectable in the UI.
 * All other providers exist in the catalog for reference but are hidden
 * until their auth, transport, and discovery implementations are complete.
 */
export const PRODUCTION_READY_PROVIDER_IDS = new Set<string>([
  'openai',
  'google',
  'google-vertex',
  'anthropic',
  'deepseek',
  'mistral',
  'groq',
  'openrouter',
  'xai',
  'ollama',
  'lm-studio',
  'llama-cpp',
  'vllm',
  'custom-openai-compat',
]);

/** Providers that are safe to display and select in the UI. */
export const SELECTABLE_PROVIDERS: readonly PlumbProvider[] =
  PLUMB_PROVIDERS.filter((p) => PRODUCTION_READY_PROVIDER_IDS.has(p.id));

/** All providers including non-production-ready (for reference only). */
export const ALL_PROVIDERS: readonly PlumbProvider[] = PLUMB_PROVIDERS;

// ─── Index helpers ────────────────────────────────────────────────────

const PROVIDER_BY_ID = new Map<string, PlumbProvider>(
  SELECTABLE_PROVIDERS.map((p) => [p.id, p]),
);

/** Look up a provider by its ID. */
export function getPlumbProvider(id: string): PlumbProvider | undefined {
  return PROVIDER_BY_ID.get(id);
}

/** Get all providers in a given category (production-ready only). */
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

/** All coding plan / subscription providers (production-ready only). */
export const CODING_PLAN_PROVIDERS = SELECTABLE_PROVIDERS.filter(
  (p) => p.category === PlumbProviderCategory.CODING_PLAN,
);

/** All OAuth account providers (production-ready only). */
export const OAUTH_PROVIDERS = SELECTABLE_PROVIDERS.filter(
  (p) =>
    p.category === PlumbProviderCategory.OAUTH_ACCOUNT &&
    p.authMethods.some((m) => m.type === 'oauth'),
);

/** All API key providers (production-ready only). */
export const API_KEY_PROVIDERS = SELECTABLE_PROVIDERS.filter(
  (p) => p.category === PlumbProviderCategory.API_KEY,
);

/** All local / keyless providers (production-ready only). */
export const LOCAL_PROVIDERS = SELECTABLE_PROVIDERS.filter(
  (p) => p.category === PlumbProviderCategory.LOCAL,
);

/** Providers that can be used without authentication. */
export const UNAUTHENTICATED_PROVIDERS = SELECTABLE_PROVIDERS.filter(
  (p) => p.allowUnauthenticated === true,
);

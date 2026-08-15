/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type PlumbModel,
  type PlumbKnownApi,
  type PlumbProviderId,
} from '../types.js';

// ─── Initialization ────────────────────────────────────────────────────

let initialized = false;

/** Register all bundled models into the model registry. Call once at startup. */
export function initBundledModels(): void {
  // Models are now loaded from the generated catalog (generated-models.json)
  // This function is kept for backward compatibility but is a no-op.
}

// ─── Bundled catalog ───────────────────────────────────────────────────

type ProviderId = PlumbProviderId;
type Api = PlumbKnownApi;

const BUNDLED_CATALOG: Map<ProviderId, PlumbModel[]> = new Map([
  // ── OpenAI ─────────────────────────────────────────────────────
  [
    'openai',
    [
      {
        id: 'gpt-5.5',
        provider: 'openai',
        api: 'openai-completions' as Api,
        contextWindow: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
      },
      {
        id: 'gpt-5.6',
        provider: 'openai',
        api: 'openai-responses' as Api,
        requestModelId: 'gpt-5.6',
        contextWindow: 372000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text+image',
        isPreview: true,
      },
      {
        id: 'gpt-5.1',
        provider: 'openai',
        api: 'openai-completions' as Api,
        contextWindow: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
      },
      {
        id: 'gpt-5.1-mini',
        provider: 'openai',
        api: 'openai-completions' as Api,
        contextWindow: 272000,
        maxTokens: 128000,
        reasoning: false,
        input: 'text',
      },
      {
        id: 'gpt-5-codex',
        provider: 'openai',
        api: 'openai-completions' as Api,
        contextWindow: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
      },
      {
        id: 'o4-mini',
        provider: 'openai',
        api: 'openai-responses' as Api,
        contextWindow: 200000,
        maxTokens: 100000,
        reasoning: true,
        input: 'text',
      },
      {
        id: 'o3',
        provider: 'openai',
        api: 'openai-responses' as Api,
        contextWindow: 200000,
        maxTokens: 100000,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── OpenAI Codex ────────────────────────────────────────────────
  [
    'openai-codex',
    [
      {
        id: 'gpt-5.5',
        provider: 'openai-codex',
        api: 'openai-codex-responses' as Api,
        contextWindow: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
      {
        id: 'gpt-5.6',
        provider: 'openai-codex',
        api: 'openai-codex-responses' as Api,
        contextWindow: 372000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text+image',
        isOAuth: true,
        isPreview: true,
      },
      {
        id: 'gpt-5.1',
        provider: 'openai-codex',
        api: 'openai-codex-responses' as Api,
        contextWindow: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
      {
        id: 'gpt-5-codex',
        provider: 'openai-codex',
        api: 'openai-codex-responses' as Api,
        contextWindow: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
      {
        id: 'o4-mini',
        provider: 'openai-codex',
        api: 'openai-codex-responses' as Api,
        contextWindow: 200000,
        maxTokens: 100000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
    ],
  ],
  // ── Anthropic ──────────────────────────────────────────────────
  [
    'anthropic',
    [
      {
        id: 'claude-opus-4-8',
        provider: 'anthropic',
        api: 'anthropic-messages' as Api,
        contextWindow: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text+image',
        thinking: {
          mode: 'anthropic-adaptive',
          effortBudgets: { low: 4000, medium: 8000, high: 16000 },
        },
      },
      {
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
        api: 'anthropic-messages' as Api,
        contextWindow: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text+image',
        thinking: {
          mode: 'anthropic-adaptive',
          effortBudgets: { low: 4000, medium: 8000, high: 16000 },
        },
      },
      {
        // Anthropic never shipped a Haiku 4.6 -- only Sonnet/Opus got 4.6
        // revisions. Haiku 4.5 (claude-haiku-4-5-20251001) is the current
        // Haiku-tier model; platform.claude.com/docs/en/about-claude/models/overview.
        id: 'claude-haiku-4-5-20251001',
        provider: 'anthropic',
        api: 'anthropic-messages' as Api,
        contextWindow: 200000,
        maxTokens: 64000,
        reasoning: false,
        input: 'text+image',
      },
      {
        id: 'claude-opus-4-6',
        provider: 'anthropic',
        api: 'anthropic-messages' as Api,
        contextWindow: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text+image',
        thinking: {
          mode: 'anthropic-adaptive',
          effortBudgets: { high: 16000 },
        },
      },
    ],
  ],
  // ── GitHub Copilot ─────────────────────────────────────────────
  [
    'github-copilot',
    [
      {
        id: 'gpt-5.5',
        provider: 'github-copilot',
        api: 'openai-completions' as Api,
        contextWindow: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
      {
        // GitHub Copilot deliberately caps context at 200K regardless of
        // the native 1M model capability (product decision, not a model
        // limit -- github.com/github/copilot-cli#3355).
        id: 'claude-sonnet-4-6',
        provider: 'github-copilot',
        api: 'openai-completions' as Api,
        contextWindow: 200000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
      {
        id: 'claude-opus-4-8',
        provider: 'github-copilot',
        api: 'openai-completions' as Api,
        contextWindow: 200000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
    ],
  ],
  // ── Cursor ─────────────────────────────────────────────────────
  [
    'cursor',
    [
      {
        id: 'claude-4.6-opus-high',
        provider: 'cursor',
        api: 'cursor-agent' as Api,
        contextWindow: 200000,
        maxTokens: 32000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
      {
        id: 'claude-4.6-sonnet',
        provider: 'cursor',
        api: 'cursor-agent' as Api,
        contextWindow: 200000,
        maxTokens: 32000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
      {
        id: 'gpt-5.5',
        provider: 'cursor',
        api: 'cursor-agent' as Api,
        contextWindow: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
    ],
  ],
  // ── Google Gemini ──────────────────────────────────────────────
  [
    'google',
    [
      {
        id: 'gemini-3.1-pro-preview',
        provider: 'google',
        api: 'google-generative-ai' as Api,
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: 'text+image+audio',
        isPreview: true,
        thinking: { mode: 'google-level' },
      },
      {
        id: 'gemini-3.5-flash-preview',
        provider: 'google',
        api: 'google-generative-ai' as Api,
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: false,
        input: 'text+image',
        isPreview: true,
      },
      {
        id: 'gemini-2.5-pro',
        provider: 'google',
        api: 'google-generative-ai' as Api,
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: 'text+image+audio',
        thinking: { mode: 'google-level' },
      },
      {
        id: 'gemini-2.5-flash',
        provider: 'google',
        api: 'google-generative-ai' as Api,
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: false,
        input: 'text+image+audio',
      },
    ],
  ],
  // ── Google Vertex ──────────────────────────────────────────────
  [
    'google-vertex',
    [
      {
        id: 'gemini-3.1-pro-preview',
        provider: 'google-vertex',
        api: 'google-vertex' as Api,
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: 'text+image+audio',
        isPreview: true,
      },
      {
        id: 'gemini-2.5-pro',
        provider: 'google-vertex',
        api: 'google-vertex' as Api,
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: 'text+image+audio',
      },
      {
        id: 'gemini-2.5-flash',
        provider: 'google-vertex',
        api: 'google-vertex' as Api,
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: false,
        input: 'text+image+audio',
      },
    ],
  ],
  // ── PLUMB (Cloud Code Assist) ──────────────────────────────
  [
    'google-gemini-cli',
    [
      {
        id: 'gemini-3.1-pro-preview',
        provider: 'google-gemini-cli',
        api: 'google-gemini-cli' as Api,
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: 'text+image',
        isPreview: true,
        isOAuth: true,
      },
      {
        id: 'gemini-2.5-pro',
        provider: 'google-gemini-cli',
        api: 'google-gemini-cli' as Api,
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: 'text+image+audio',
        isOAuth: true,
      },
      {
        id: 'gemini-2.5-flash',
        provider: 'google-gemini-cli',
        api: 'google-gemini-cli' as Api,
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: false,
        input: 'text+image+audio',
        isOAuth: true,
      },
    ],
  ],
  // ── Antigravity ────────────────────────────────────────────────
  [
    'antigravity',
    [
      {
        id: 'gemini-3.1-pro',
        provider: 'antigravity',
        api: 'google-generative-ai' as Api,
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: 'text+image',
        isOAuth: true,
      },
    ],
  ],
  // ── DeepSeek ───────────────────────────────────────────────────
  [
    'deepseek',
    [
      {
        id: 'deepseek-v4-pro',
        provider: 'deepseek',
        api: 'openai-completions' as Api,
        contextWindow: 1048576,
        maxTokens: 384000,
        reasoning: true,
        input: 'text',
      },
      {
        id: 'deepseek-v4',
        provider: 'deepseek',
        api: 'openai-completions' as Api,
        contextWindow: 1048576,
        maxTokens: 384000,
        reasoning: false,
        input: 'text',
      },
      {
        id: 'deepseek-r1',
        provider: 'deepseek',
        api: 'openai-completions' as Api,
        contextWindow: 256000,
        maxTokens: 8192,
        reasoning: true,
        input: 'text',
        thinking: { mode: 'effort' },
      },
    ],
  ],
  // ── xAI ────────────────────────────────────────────────────────
  [
    'xai',
    [
      {
        id: 'grok-4-fast-non-reasoning',
        provider: 'xai',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 65536,
        reasoning: false,
        input: 'text+image',
      },
      {
        id: 'grok-4.3',
        provider: 'xai',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 65536,
        reasoning: true,
        input: 'text+image',
      },
    ],
  ],
  [
    'xai-oauth',
    [
      {
        id: 'grok-4.3',
        provider: 'xai-oauth',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 65536,
        reasoning: true,
        input: 'text+image',
        isOAuth: true,
      },
    ],
  ],
  // ── Mistral ────────────────────────────────────────────────────
  [
    'mistral',
    [
      {
        id: 'devstral-medium-latest',
        provider: 'mistral',
        api: 'openai-completions' as Api,
        contextWindow: 256000,
        maxTokens: 65536,
        reasoning: false,
        input: 'text',
      },
      {
        id: 'mistral-large-latest',
        provider: 'mistral',
        api: 'openai-completions' as Api,
        contextWindow: 256000,
        maxTokens: 32000,
        reasoning: false,
        input: 'text+image',
      },
    ],
  ],
  // ── Groq ───────────────────────────────────────────────────────
  [
    'groq',
    [
      {
        id: 'openai/gpt-oss-120b',
        provider: 'groq',
        api: 'openai-completions' as Api,
        contextWindow: 131072,
        maxTokens: 65536,
        reasoning: false,
        input: 'text',
      },
    ],
  ],
  // ── Kimi/Moonshot ──────────────────────────────────────────────
  [
    'moonshot',
    [
      {
        id: 'kimi-k2.7-code',
        provider: 'moonshot',
        api: 'openai-completions' as Api,
        contextWindow: 262144,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  [
    'kimi-code',
    [
      {
        id: 'kimi-for-coding',
        provider: 'kimi-code',
        api: 'openai-completions' as Api,
        contextWindow: 262144,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
    ],
  ],
  // ── OpenRouter ─────────────────────────────────────────────────
  [
    'openrouter',
    [
      {
        id: 'openai/gpt-5.5',
        provider: 'openrouter',
        api: 'openrouter' as Api,
        contextWindow: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
      },
      {
        id: 'anthropic/claude-opus-4-8',
        provider: 'openrouter',
        api: 'openrouter' as Api,
        contextWindow: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text+image',
      },
      {
        id: 'anthropic/claude-sonnet-4-6',
        provider: 'openrouter',
        api: 'openrouter' as Api,
        contextWindow: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text+image',
      },
    ],
  ],
  // ── Together AI ────────────────────────────────────────────────
  [
    'together',
    [
      {
        id: 'moonshotai/Kimi-K2.7-Code',
        provider: 'together',
        api: 'openai-completions' as Api,
        contextWindow: 262144,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── Fireworks ──────────────────────────────────────────────────
  [
    'fireworks',
    [
      {
        id: 'kimi-k2.7-code',
        provider: 'fireworks',
        api: 'openai-completions' as Api,
        contextWindow: 262144,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── Cerebras ───────────────────────────────────────────────────
  [
    'cerebras',
    [
      {
        id: 'zai-glm-4.7',
        provider: 'cerebras',
        api: 'openai-completions' as Api,
        contextWindow: 200000,
        maxTokens: 128000,
        reasoning: false,
        input: 'text',
      },
    ],
  ],
  // ── Meta ───────────────────────────────────────────────────────
  [
    'meta',
    [
      {
        id: 'muse-spark-1.1',
        provider: 'meta',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 16384,
        reasoning: false,
        input: 'text',
      },
    ],
  ],
  // ── MiniMax ────────────────────────────────────────────────────
  [
    'minimax',
    [
      {
        id: 'MiniMax-M3',
        provider: 'minimax',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 64000,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── Ollama ─────────────────────────────────────────────────────
  [
    'ollama',
    [
      {
        id: 'gpt-oss:20b',
        provider: 'ollama',
        api: 'ollama-chat' as Api,
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
        input: 'text',
      },
      {
        id: 'gpt-oss:120b',
        provider: 'ollama',
        api: 'ollama-chat' as Api,
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
        input: 'text',
      },
      {
        id: 'llama3.3:70b',
        provider: 'ollama',
        api: 'ollama-chat' as Api,
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
        input: 'text',
      },
      {
        id: 'deepseek-r1:70b',
        provider: 'ollama',
        api: 'ollama-chat' as Api,
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: true,
        input: 'text',
      },
      {
        id: 'codellama:70b',
        provider: 'ollama',
        api: 'ollama-chat' as Api,
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
        input: 'text',
      },
      {
        id: 'qwen3:235b',
        provider: 'ollama',
        api: 'ollama-chat' as Api,
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── LM Studio ──────────────────────────────────────────────────
  [
    'lm-studio',
    [
      {
        id: 'llama-3-8b',
        provider: 'lm-studio',
        api: 'ollama-chat' as Api,
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
        input: 'text',
      },
      {
        id: 'auto',
        provider: 'lm-studio',
        api: 'ollama-chat' as Api,
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
        input: 'text',
      },
    ],
  ],
  // ── vLLM ───────────────────────────────────────────────────────
  [
    'vllm',
    [
      {
        id: 'gpt-oss-20b',
        provider: 'vllm',
        api: 'ollama-chat' as Api,
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
        input: 'text',
      },
    ],
  ],
  // ── Perplexity ─────────────────────────────────────────────────
  [
    'perplexity',
    [
      {
        id: 'sonar-reasoning-pro',
        provider: 'perplexity',
        api: 'openai-completions' as Api,
        contextWindow: 128000,
        maxTokens: 8000,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── Novita ─────────────────────────────────────────────────────
  [
    'novita',
    [
      {
        id: 'moonshotai/kimi-k2.7-code',
        provider: 'novita',
        api: 'openai-completions' as Api,
        contextWindow: 262144,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── HuggingFace ────────────────────────────────────────────────
  [
    'huggingface',
    [
      {
        id: 'deepseek-ai/DeepSeek-R1',
        provider: 'huggingface',
        api: 'openai-completions' as Api,
        contextWindow: 256000,
        maxTokens: 8192,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── NVIDIA ─────────────────────────────────────────────────────
  [
    'nvidia',
    [
      {
        id: 'nvidia/llama-3.1-nemotron-70b-instruct',
        provider: 'nvidia',
        api: 'openai-completions' as Api,
        contextWindow: 131072,
        maxTokens: 4096,
        reasoning: false,
        input: 'text',
      },
    ],
  ],
  // ── SiliconFlow ────────────────────────────────────────────────
  [
    'siliconflow',
    [
      {
        id: 'zai-org/GLM-5.1',
        provider: 'siliconflow',
        api: 'openai-completions' as Api,
        contextWindow: 200000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  [
    'siliconflow-cn',
    [
      {
        id: 'deepseek-ai/DeepSeek-V4-Pro',
        provider: 'siliconflow-cn',
        api: 'openai-completions' as Api,
        contextWindow: 1048576,
        maxTokens: 384000,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── Alibaba ────────────────────────────────────────────────────
  [
    'alibaba-coding-plan',
    [
      {
        id: 'qwen3.7-plus',
        provider: 'alibaba-coding-plan',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
      },
      {
        id: 'qwen3.7-coder-plus',
        provider: 'alibaba-coding-plan',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── Zhipu ──────────────────────────────────────────────────────
  [
    'zhipu-coding-plan',
    [
      {
        id: 'glm-5.1',
        provider: 'zhipu-coding-plan',
        api: 'openai-completions' as Api,
        contextWindow: 200000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
        name: 'GLM-5.1',
      },
      {
        id: 'glm-4.7-flash',
        provider: 'zhipu-coding-plan',
        api: 'openai-completions' as Api,
        contextWindow: 200000,
        maxTokens: 128000,
        reasoning: false,
        input: 'text',
        name: 'GLM-4.7 Flash',
      },
      {
        id: 'glm-4.7',
        provider: 'zhipu-coding-plan',
        api: 'openai-completions' as Api,
        contextWindow: 200000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
        name: 'GLM-4.7',
      },
    ],
  ],
  // ── Z.AI ───────────────────────────────────────────────────────
  [
    'zai',
    [
      {
        id: 'glm-5.2',
        provider: 'zai',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── Azure ──────────────────────────────────────────────────────
  [
    'azure',
    [
      {
        id: 'gpt-5.5',
        provider: 'azure',
        api: 'azure-openai-responses' as Api,
        contextWindow: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── Bedrock ────────────────────────────────────────────────────
  [
    'amazon-bedrock',
    [
      {
        id: 'us.anthropic.claude-opus-4-8',
        provider: 'amazon-bedrock',
        api: 'bedrock-converse-stream' as Api,
        contextWindow: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text+image',
      },
      {
        id: 'us.anthropic.claude-sonnet-4-6',
        provider: 'amazon-bedrock',
        api: 'bedrock-converse-stream' as Api,
        contextWindow: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text+image',
      },
    ],
  ],
  // ── OpenCode Go ────────────────────────────────────────────────
  [
    'opencode-go',
    [
      {
        id: 'kimi-k2.7-code',
        provider: 'opencode-go',
        api: 'openai-completions' as Api,
        contextWindow: 262144,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
    ],
  ],
  // ── OpenCode Zen ───────────────────────────────────────────────
  [
    'opencode-zen',
    [
      {
        id: 'claude-opus-4-8',
        provider: 'opencode-zen',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text+image',
        isOAuth: true,
      },
      {
        id: 'claude-sonnet-4-6',
        provider: 'opencode-zen',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text+image',
        isOAuth: true,
      },
    ],
  ],
  // ── GitLab Duo ─────────────────────────────────────────────────
  [
    'gitlab-duo',
    [
      {
        id: 'duo-chat-opus-4-6',
        provider: 'gitlab-duo',
        api: 'openai-completions' as Api,
        contextWindow: 200000,
        maxTokens: 32000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
    ],
  ],
  [
    'gitlab-duo-agent',
    [
      {
        id: 'claude_sonnet_4_6_vertex',
        provider: 'gitlab-duo-agent',
        api: 'gitlab-duo-agent' as Api,
        contextWindow: 200000,
        maxTokens: 32000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
    ],
  ],
  // ── Devin ──────────────────────────────────────────────────────
  [
    'devin',
    [
      {
        id: 'swe-1-6',
        provider: 'devin',
        api: 'devin-agent' as Api,
        contextWindow: 200000,
        maxTokens: 32000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
    ],
  ],
  // ── Google Login ───────────────────────────────────────────────
  [
    'google-login',
    [
      {
        id: 'gemini-2.5-pro',
        provider: 'google-login',
        api: 'google-generative-ai' as Api,
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: 'text+image+audio',
        isOAuth: true,
      },
      {
        id: 'gemini-2.5-flash',
        provider: 'google-login',
        api: 'google-generative-ai' as Api,
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: false,
        input: 'text+image+audio',
        isOAuth: true,
      },
      {
        id: 'gemini-3.1-pro-preview',
        provider: 'google-login',
        api: 'google-generative-ai' as Api,
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: true,
        input: 'text+image+audio',
        isOAuth: true,
        isPreview: true,
      },
    ],
  ],
  // ── AIML API ───────────────────────────────────────────────────
  [
    'aimlapi',
    [
      {
        id: 'gpt-5.5-2026-04-23',
        provider: 'aimlapi',
        api: 'openai-completions' as Api,
        contextWindow: 272000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── Sakana ─────────────────────────────────────────────────────
  [
    'sakana',
    [
      {
        id: 'fugu',
        provider: 'sakana',
        api: 'openai-completions' as Api,
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
        input: 'text',
      },
    ],
  ],
  // ── Xiaomi ─────────────────────────────────────────────────────
  [
    'xiaomi',
    [
      {
        id: 'mimo-v2.5',
        provider: 'xiaomi',
        api: 'openai-completions' as Api,
        contextWindow: 256000,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
    ],
  ],
  // ── Alibaba Token Plan ─────────────────────────────────────────
  [
    'alibaba-token-plan',
    [
      {
        id: 'qwen3.7-plus',
        provider: 'alibaba-token-plan',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── MiniMax Code ───────────────────────────────────────────────
  [
    'minimax-code',
    [
      {
        id: 'MiniMax-M3',
        provider: 'minimax-code',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 64000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
    ],
  ],
  // ── Umans ──────────────────────────────────────────────────────
  [
    'umans',
    [
      {
        id: 'umans-coder',
        provider: 'umans',
        api: 'openai-completions' as Api,
        contextWindow: 128000,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
      },
    ],
  ],
  // ── Wafer Serverless ───────────────────────────────────────────
  [
    'wafer-serverless',
    [
      {
        id: 'GLM-5.1',
        provider: 'wafer-serverless',
        api: 'openai-completions' as Api,
        contextWindow: 200000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text',
        isOAuth: true,
      },
    ],
  ],
  // ── Custom endpoint ────────────────────────────────────────────
  [
    'custom-openai-compat',
    [
      {
        id: 'custom',
        provider: 'custom-openai-compat',
        api: 'openai-completions' as Api,
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
        input: 'text',
      },
    ],
  ],
  // ── Coding plans (newly activated) ──────────────────────────────
  [
    'alibaba-coding-plan',
    [
      {
        id: 'qwen3.7-plus',
        provider: 'alibaba-coding-plan',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
        name: 'Qwen 3.7 Plus',
      },
      {
        id: 'qwen3.7-coder-plus',
        provider: 'alibaba-coding-plan',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
        name: 'Qwen 3.7 Coder Plus',
      },
    ],
  ],
  [
    'minimax-code',
    [
      {
        id: 'MiniMax-M3',
        provider: 'minimax-code',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 64000,
        reasoning: true,
        input: 'text',
        name: 'MiniMax M3',
      },
    ],
  ],
  [
    'minimax-code-cn',
    [
      {
        id: 'MiniMax-M3',
        provider: 'minimax-code-cn',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 64000,
        reasoning: true,
        input: 'text',
        name: 'MiniMax M3',
      },
    ],
  ],
  [
    'umans',
    [
      {
        id: 'umans-coder',
        provider: 'umans',
        api: 'openai-completions' as Api,
        contextWindow: 128000,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
        name: 'Umans Coder',
      },
    ],
  ],
  [
    'sakana',
    [
      {
        id: 'fugu',
        provider: 'sakana',
        api: 'openai-completions' as Api,
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
        input: 'text',
        name: 'Fugu',
      },
    ],
  ],
  [
    'firepass',
    [
      {
        id: 'kimi-k2.6-turbo',
        provider: 'firepass',
        api: 'openai-completions' as Api,
        contextWindow: 262144,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
        name: 'Kimi K2.6 Turbo',
      },
    ],
  ],
  [
    'opencode-go',
    [
      {
        id: 'kimi-k2.7-code',
        provider: 'opencode-go',
        api: 'openai-completions' as Api,
        contextWindow: 262144,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
        name: 'Kimi K2.7 Code',
      },
    ],
  ],
  [
    'opencode-zen',
    [
      {
        id: 'claude-opus-4-8',
        provider: 'opencode-zen',
        api: 'anthropic-messages' as Api,
        contextWindow: 1000000,
        maxTokens: 128000,
        reasoning: true,
        input: 'text+image',
        name: 'Claude Opus 4.8',
      },
    ],
  ],
  [
    'qwen-portal',
    [
      {
        id: 'coder-model',
        provider: 'qwen-portal',
        api: 'openai-completions' as Api,
        contextWindow: 1000000,
        maxTokens: 65536,
        reasoning: true,
        input: 'text',
        name: 'Qwen Coder',
      },
    ],
  ],
]);

// NOTE: The following provider IDs from the OMP catalog use the same
// provider IDs as equivalent entries above and share their model lists:
//   'anthropic' (shared between OAuth and API key flows — distinguished by auth method)
//   'zai-coding-plan' → stored under 'zai'
//   'qwen-portal' → models discovered dynamically
//   'minimax-code-cn' → shares minimax-code models
//   'xiaomi-token-plan-sgp/ams/cn' → shares xiaomi models
//   'nanogpt', 'venice', 'synthetic', 'zenmux', 'kilo', 'litellm',
//   'cloudflare-ai-gateway', 'vercel-ai-gateway', 'coreweave', 'baseten',
//   'qianfan', 'firepass', 'ollama-cloud'
//   → use dynamically-discovered models or proxy to upstream providers

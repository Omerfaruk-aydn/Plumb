#!/usr/bin/env node
/**
 * Generate PLUMB model catalog from OMP upstream models.json
 *
 * Source: D:\PLUMB-upstreams\oh-my-pi\packages\catalog\src\models.json
 * Upstream SHA: 4df68d60438423b384b2b47fb3d6835641624757
 *
 * This script reads the OMP models.json and generates a PLUMB-compatible
 * model catalog with proper type mapping.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const OMP_MODELS_PATH = resolve(__dirname, '../packages/provider/src/catalog/omp-models.json');
const OUTPUT_PATH = resolve(__dirname, '../packages/provider/src/catalog/generated-models.json');
const MANIFEST_PATH = resolve(__dirname, 'plumb-model-catalog-manifest.json');

// Map OMP API types to PLUMB API types
const API_MAP = {
  'openai-completions': 'openai-completions',
  'openai-responses': 'openai-responses',
  'openai-codex-responses': 'openai-codex-responses',
  'azure-openai-responses': 'azure-openai-responses',
  'anthropic-messages': 'anthropic-messages',
  'bedrock-converse-stream': 'bedrock-converse-stream',
  'google-generative-ai': 'google-generative-ai',
  'google-gemini-cli': 'google-gemini-cli',
  'google-vertex': 'google-vertex',
  'ollama-chat': 'ollama-chat',
  'openrouter': 'openrouter',
  'cursor-agent': 'cursor-agent',
  'devin-agent': 'devin-agent',
  'gitlab-duo-agent': 'gitlab-duo-agent',
};

// Map OMP providers to PLUMB provider IDs
const PROVIDER_MAP = {
  'aimlapi': 'aimlapi',
  'alibaba-coding-plan': 'alibaba-coding-plan',
  'alibaba-token-plan': 'alibaba-token-plan',
  'amazon-bedrock': 'amazon-bedrock',
  'anthropic': 'anthropic',
  'antigravity': 'antigravity',
  'azure': 'azure',
  'baseten': 'baseten',
  'cerebras': 'cerebras',
  'cloudflare-ai-gateway': 'cloudflare-ai-gateway',
  'coreweave': 'coreweave',
  'cursor': 'cursor',
  'deepseek': 'deepseek',
  'devin': 'devin',
  'firepass': 'firepass',
  'fireworks': 'fireworks',
  'gitlab-duo': 'gitlab-duo',
  'gitlab-duo-agent': 'gitlab-duo-agent',
  'google': 'google',
  'google-antigravity': 'antigravity',
  'google-gemini-cli': 'google-gemini-cli',
  'google-login': 'google-login',
  'google-vertex': 'google-vertex',
  'groq': 'groq',
  'github-copilot': 'github-copilot',
  'huggingface': 'huggingface',
  'kilo': 'kilo',
  'kimi-code': 'kimi-code',
  'lm-studio': 'lm-studio',
  'litellm': 'litellm',
  'llama-cpp': 'llama-cpp',
  'meta': 'meta',
  'minimax': 'minimax',
  'minimax-code': 'minimax-code',
  'minimax-code-cn': 'minimax-code-cn',
  'mistral': 'mistral',
  'moonshot': 'moonshot',
  'nanogpt': 'nanogpt',
  'nvidia': 'nvidia',
  'novita': 'novita',
  'ollama': 'ollama',
  'ollama-cloud': 'ollama-cloud',
  'openai': 'openai',
  'openai-codex': 'openai-codex',
  'openai-codex-device': 'openai-codex',
  'openrouter': 'openrouter',
  'opencode-go': 'opencode-go',
  'opencode-zen': 'opencode-zen',
  'perplexity': 'perplexity',
  'qianfan': 'qianfan',
  'qwen-portal': 'qwen-portal',
  'sakana': 'sakana',
  'siliconflow': 'siliconflow',
  'siliconflow-cn': 'siliconflow-cn',
  'synthetic': 'synthetic',
  'together': 'together',
  'umans': 'umans',
  'venice': 'venice',
  'vercel-ai-gateway': 'vercel-ai-gateway',
  'vllm': 'vllm',
  'wafer-serverless': 'wafer-serverless',
  'xai': 'xai',
  'xai-oauth': 'xai-oauth',
  'xiaomi': 'xiaomi',
  'xiaomi-token-plan-ams': 'xiaomi-token-plan-ams',
  'xiaomi-token-plan-cn': 'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp': 'xiaomi-token-plan-sgp',
  'zai': 'zai',
  'zai-coding-plan': 'zai-coding-plan',
  'zhipu-coding-plan': 'zhipu-coding-plan',
  'zenmux': 'zenmux',
};

function convertModel(ompProviderId, ompSpec) {
  const plumbProviderId = PROVIDER_MAP[ompProviderId] ?? ompProviderId;
  const api = API_MAP[ompSpec.api] ?? ompSpec.api;

  return {
    id: ompSpec.id,
    name: ompSpec.name ?? ompSpec.id,
    provider: plumbProviderId,
    api,
    requestModelId: ompSpec.requestModelId,
    contextWindow: ompSpec.contextWindow ?? 131072,
    maxTokens: ompSpec.maxTokens ?? 32768,
    reasoning: ompSpec.reasoning ?? false,
    input: Array.isArray(ompSpec.input)
      ? ompSpec.input.includes('image')
        ? 'text+image'
        : 'text'
      : 'text',
    baseUrl: ompSpec.baseUrl,
    isOAuth: ompSpec.isOAuth ?? false,
    isPreview: ompSpec.isPreview ?? false,
    isDeprecated: ompSpec.isDeprecated ?? false,
    description: ompSpec.description,
    pricing: ompSpec.cost
      ? {
          input: ompSpec.cost.input ?? 0,
          output: ompSpec.cost.output ?? 0,
          cacheRead: ompSpec.cost.cacheRead,
          cacheWrite: ompSpec.cost.cacheWrite,
        }
      : undefined,
    thinking: ompSpec.thinking,
    openaiCompat: ompSpec.compat,
    tags: [],
  };
}

function main() {
  console.log('Reading OMP models.json...');
  const ompData = JSON.parse(readFileSync(OMP_MODELS_PATH, 'utf-8'));

  const providers = Object.keys(ompData);
  console.log(`Found ${providers.length} providers`);

  const plumbCatalog = {};
  let totalModels = 0;
  let skippedProviders = 0;

  for (const ompProviderId of providers) {
    const plumbProviderId = PROVIDER_MAP[ompProviderId];
    if (!plumbProviderId) {
      console.warn(`Skipping unknown provider: ${ompProviderId}`);
      skippedProviders++;
      continue;
    }

    const ompModels = ompData[ompProviderId];
    const modelIds = Object.keys(ompModels);

    if (!plumbCatalog[plumbProviderId]) {
      plumbCatalog[plumbProviderId] = {};
    }

    for (const modelId of modelIds) {
      const ompSpec = ompModels[modelId];
      const plumbModel = convertModel(ompProviderId, ompSpec);
      plumbCatalog[plumbProviderId][plumbModel.id] = plumbModel;
      totalModels++;
    }
  }

  console.log(`Converted ${totalModels} models across ${Object.keys(plumbCatalog).length} providers`);
  console.log(`Skipped ${skippedProviders} unknown providers`);

  // Write catalog
  writeFileSync(OUTPUT_PATH, JSON.stringify(plumbCatalog, null, 2));
  console.log(`Written to ${OUTPUT_PATH}`);

  // Write manifest
  const manifest = {
    generatedAt: new Date().toISOString(),
    upstreamRepo: 'https://github.com/can1357/oh-my-pi.git',
    upstreamSha: '4df68d60438423b384b2b47fb3d6835641624757',
    upstreamPath: 'packages/catalog/src/models.json',
    totalModels,
    totalProviders: Object.keys(plumbCatalog).length,
    skippedProviders,
    schemaVersion: 1,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`Manifest written to ${MANIFEST_PATH}`);
}

main();

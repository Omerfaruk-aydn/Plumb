/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlumbProvider, PlumbAuthMethod } from '../types.js';
import { PlumbProviderCategory } from '../types.js';

// ─── Coding plan definitions ───────────────────────────────────────────

export interface CodingPlanDefinition {
  id: string;
  name: string;
  description: string;
  authUrl: string;
  endpoint: string;
  validationKind:
    | 'chat-completions'
    | 'models-endpoint'
    | 'anthropic-messages'
    | 'none';
  validationModel?: string;
  envVars: string[];
  models: Array<{
    id: string;
    name: string;
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
  }>;
}

// ─── All API-key coding plans ──────────────────────────────────────────

export const CODING_PLANS: CodingPlanDefinition[] = [
  // ── Alibaba Coding Plan ──────────────────────────────────────────
  {
    id: 'alibaba-coding-plan',
    name: 'Alibaba Coding Plan',
    description:
      'Alibaba Cloud model studio coding plan. Supports International and China regions.',
    authUrl: 'https://modelstudio.console.alibabacloud.com',
    endpoint: 'https://coding-intl.dashscope.aliyuncs.com/v1',
    validationKind: 'chat-completions',
    validationModel: 'qwen3.5-plus',
    envVars: ['ALIBABA_CODING_PLAN_API_KEY', 'ALIBABA_API_KEY'],
    models: [
      {
        id: 'qwen3.7-plus',
        name: 'Qwen 3.7 Plus',
        contextWindow: 256000,
        maxTokens: 65536,
        reasoning: true,
      },
      {
        id: 'qwen3.7-coder-plus',
        name: 'Qwen 3.7 Coder Plus',
        contextWindow: 256000,
        maxTokens: 65536,
        reasoning: true,
      },
      {
        id: 'qwen3.5-plus',
        name: 'Qwen 3.5 Plus',
        contextWindow: 128000,
        maxTokens: 65536,
        reasoning: false,
      },
    ],
  },

  // ── MiniMax Coding Plan ──────────────────────────────────────────
  {
    id: 'minimax-code',
    name: 'MiniMax Coding Plan',
    description: 'MiniMax international token plan.',
    authUrl: 'https://platform.minimax.io/subscription',
    endpoint: 'https://api.minimax.io/v1',
    validationKind: 'chat-completions',
    validationModel: 'MiniMax-M3',
    envVars: ['MINIMAX_CODE_API_KEY', 'MINIMAX_API_KEY'],
    models: [
      {
        id: 'MiniMax-M3',
        name: 'MiniMax M3',
        contextWindow: 1000000,
        maxTokens: 65536,
        reasoning: true,
      },
      {
        id: 'MiniMax-M3-Flash',
        name: 'MiniMax M3 Flash',
        contextWindow: 500000,
        maxTokens: 32768,
        reasoning: false,
      },
    ],
  },

  // ── MiniMax Coding Plan CN ───────────────────────────────────────
  {
    id: 'minimax-code-cn',
    name: 'MiniMax Coding Plan (China)',
    description: 'MiniMax China token plan.',
    authUrl: 'https://platform.minimaxi.com/subscription',
    endpoint: 'https://api.minimaxi.com/v1',
    validationKind: 'chat-completions',
    validationModel: 'MiniMax-M3',
    envVars: ['MINIMAX_CODE_CN_API_KEY'],
    models: [
      {
        id: 'MiniMax-M3',
        name: 'MiniMax M3',
        contextWindow: 1000000,
        maxTokens: 65536,
        reasoning: true,
      },
    ],
  },

  // ── Umans AI ─────────────────────────────────────────────────────
  {
    id: 'umans',
    name: 'Umans AI Coding Plan',
    description: 'Umans AI coding plan. API key format: sk-...',
    authUrl: 'https://app.umans.ai/billing',
    endpoint: 'https://api.code.umans.ai',
    validationKind: 'anthropic-messages',
    validationModel: 'umans-coder',
    envVars: ['UMANS_AI_CODING_PLAN_API_KEY'],
    models: [
      {
        id: 'umans-coder',
        name: 'Umans Coder',
        contextWindow: 128000,
        maxTokens: 65536,
        reasoning: true,
      },
    ],
  },

  // ── Sakana AI ────────────────────────────────────────────────────
  {
    id: 'sakana',
    name: 'Sakana AI',
    description: 'Sakana AI coding plan. API key format: sk-...',
    authUrl: 'https://platform.sakana.ai',
    endpoint: 'https://api.sakana.ai/v1',
    validationKind: 'models-endpoint',
    envVars: ['SAKANA_API_KEY', 'FUGU_API_KEY'],
    models: [
      {
        id: 'fugu',
        name: 'Fugu',
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
      },
    ],
  },

  // ── Fire Pass ────────────────────────────────────────────────────
  {
    id: 'firepass',
    name: 'Fire Pass (Fireworks Kimi)',
    description: 'Fireworks Kimi K2.6 Turbo subscription.',
    authUrl: 'https://fireworks.ai/account/api-keys',
    endpoint: 'https://api.fireworks.ai/inference/v1',
    validationKind: 'chat-completions',
    validationModel: 'accounts/fireworks/models/kimi-k2.6-turbo',
    envVars: ['FIREPASS_API_KEY'],
    models: [
      {
        id: 'kimi-k2.6-turbo',
        name: 'Kimi K2.6 Turbo',
        contextWindow: 256000,
        maxTokens: 65536,
        reasoning: true,
      },
    ],
  },

  // ── Wafer Serverless ─────────────────────────────────────────────
  {
    id: 'wafer-serverless',
    name: 'Wafer Serverless',
    description: 'Wafer pay-as-you-go plan. API key format: wfr_...',
    authUrl: 'https://app.wafer.ai/usage',
    endpoint: 'https://pass.wafer.ai/v1',
    validationKind: 'models-endpoint',
    envVars: ['WAFER_SERVERLESS_API_KEY'],
    models: [
      {
        id: 'GLM-5.1',
        name: 'GLM-5.1',
        contextWindow: 256000,
        maxTokens: 65536,
        reasoning: true,
      },
    ],
  },

  // ── OpenCode Go ──────────────────────────────────────────────────
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    description: 'OpenCode Go subscription plan.',
    authUrl: 'https://opencode.ai/auth',
    endpoint: 'https://api.opencode.ai/v1',
    validationKind: 'none',
    envVars: ['OPENCODE_API_KEY'],
    models: [
      {
        id: 'kimi-k2.7-code',
        name: 'Kimi K2.7 Code',
        contextWindow: 256000,
        maxTokens: 65536,
        reasoning: true,
      },
    ],
  },

  // ── OpenCode Zen ─────────────────────────────────────────────────
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    description: 'OpenCode Zen subscription plan.',
    authUrl: 'https://opencode.ai/auth',
    endpoint: 'https://api.opencode.ai/v1',
    validationKind: 'none',
    envVars: ['OPENCODE_API_KEY'],
    models: [
      {
        id: 'claude-opus-4-8',
        name: 'Claude Opus 4.8',
        contextWindow: 1000000,
        maxTokens: 128000,
        reasoning: true,
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        contextWindow: 1000000,
        maxTokens: 128000,
        reasoning: true,
      },
    ],
  },

  // ── Qwen Portal ──────────────────────────────────────────────────
  {
    id: 'qwen-portal',
    name: 'Qwen Portal',
    description:
      'Alibaba Qwen portal. Accepts OAuth tokens AND API keys. Open chat.qwen.ai to get your credentials.',
    authUrl: 'https://chat.qwen.ai',
    endpoint: 'https://portal.qwen.ai/v1',
    validationKind: 'chat-completions',
    validationModel: 'coder-model',
    envVars: ['QWEN_OAUTH_TOKEN', 'QWEN_PORTAL_API_KEY'],
    models: [
      {
        id: 'coder-model',
        name: 'Qwen Coder',
        contextWindow: 256000,
        maxTokens: 65536,
        reasoning: true,
      },
    ],
  },
];

// ─── Qwen Portal dual-auth login ─────────────────────────────────────

/**
 * Qwen Portal login — accepts both OAuth tokens and API keys.
 * Matching upstream: packages/ai/src/registry/qwen-portal.ts
 */
export async function loginQwenPortal(
  apiKey: string,
): Promise<{ key: string }> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error('Qwen OAuth token or API key is required.');
  }

  const result = await validateWithChatCompletions(
    'https://portal.qwen.ai/v1',
    trimmed,
    'coder-model',
  );

  if (!result.valid) {
    throw new Error(result.error ?? 'Invalid Qwen credentials.');
  }

  return { key: trimmed };
}

// ─── Provider factory ──────────────────────────────────────────────────

const PLAN_BY_ID = new Map(CODING_PLANS.map((p) => [p.id, p]));

export function getCodingPlan(id: string): CodingPlanDefinition | undefined {
  return PLAN_BY_ID.get(id);
}

export function createCodingPlanProvider(
  plan: CodingPlanDefinition,
): PlumbProvider {
  return {
    id: plan.id,
    name: plan.name,
    category: PlumbProviderCategory.CODING_PLAN,
    description: plan.description,
    authMethods: [
      {
        type: 'api_key',
        promptLabel: 'API Key',
      } satisfies PlumbAuthMethod,
    ],
    defaultModel: plan.models[0]?.id,
    envVars: plan.envVars,
    available: true,
    group: 'Coding Plans',
    order: 10,
  };
}

export function getAllCodingPlanProviders(): PlumbProvider[] {
  return CODING_PLANS.map(createCodingPlanProvider);
}

// ─── API key validation ────────────────────────────────────────────────

const VALIDATION_TIMEOUT_MS = 15000;

export interface ApiKeyValidationResult {
  valid: boolean;
  error?: string;
}

async function validateWithChatCompletions(
  endpoint: string,
  apiKey: string,
  model: string,
): Promise<ApiKeyValidationResult> {
  const url = `${endpoint.replace(/\/+$/, '')}/chat/completions`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
    });

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        error: 'Invalid API key. Check your plan credentials.',
      };
    }
    if (!response.ok) {
      return {
        valid: false,
        error: `Provider rejected the API key (HTTP ${response.status}).`,
      };
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: `Cannot reach endpoint: ${err instanceof Error ? err.message : 'Network error'}`,
    };
  }
}

async function validateWithModelsEndpoint(
  endpoint: string,
  apiKey: string,
): Promise<ApiKeyValidationResult> {
  const url = `${endpoint.replace(/\/+$/, '')}/models`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
    });

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key.' };
    }
    if (!response.ok) {
      return {
        valid: false,
        error: `API returned ${response.status}`,
      };
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: `Cannot reach endpoint: ${err instanceof Error ? err.message : 'Network error'}`,
    };
  }
}

async function validateWithAnthropicMessages(
  endpoint: string,
  apiKey: string,
  model: string,
): Promise<ApiKeyValidationResult> {
  const url = `${endpoint.replace(/\/+$/, '')}/messages`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
    });

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key.' };
    }
    if (!response.ok) {
      return {
        valid: false,
        error: `Provider rejected the API key (HTTP ${response.status}).`,
      };
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: `Cannot reach endpoint: ${err instanceof Error ? err.message : 'Network error'}`,
    };
  }
}

/**
 * Validate an API key against a coding plan endpoint.
 */
export async function validateCodingPlanApiKey(
  plan: CodingPlanDefinition,
  apiKey: string,
): Promise<ApiKeyValidationResult> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { valid: false, error: 'API key is required.' };
  }

  switch (plan.validationKind) {
    case 'chat-completions':
      return validateWithChatCompletions(
        plan.endpoint,
        trimmed,
        plan.validationModel ?? plan.models[0]?.id ?? 'default',
      );
    case 'models-endpoint':
      return validateWithModelsEndpoint(plan.endpoint, trimmed);
    case 'anthropic-messages':
      return validateWithAnthropicMessages(
        plan.endpoint,
        trimmed,
        plan.validationModel ?? plan.models[0]?.id ?? 'default',
      );
    case 'none':
      return { valid: true };
    default:
      return {
        valid: false,
        error: `Unknown validation kind: ${plan.validationKind}`,
      };
  }
}

// ─── Login flow ────────────────────────────────────────────────────────

export interface CodingPlanLoginCallbacks {
  onAuthUrl: (url: string) => void;
  onProgress: (message: string) => void;
  onPrompt: (prompt: string, placeholder?: string) => Promise<string>;
}

export interface CodingPlanLoginResult {
  type: 'api_key';
  provider: string;
  key: string;
  label: string;
  endpoint: string;
}

/**
 * Interactive login flow for any API-key coding plan.
 */
export async function loginCodingPlan(
  plan: CodingPlanDefinition,
  callbacks: CodingPlanLoginCallbacks,
): Promise<CodingPlanLoginResult> {
  callbacks.onProgress(`Opening ${plan.name} auth page...`);
  callbacks.onAuthUrl(plan.authUrl);

  const apiKey = await callbacks.onPrompt(
    `Paste your ${plan.name} API key:`,
    'sk-...',
  );

  callbacks.onProgress('Validating API key...');
  const result = await validateCodingPlanApiKey(plan, apiKey);

  if (!result.valid) {
    throw new Error(result.error ?? 'Validation failed');
  }

  callbacks.onProgress('API key validated successfully.');
  return {
    type: 'api_key',
    provider: plan.id,
    key: apiKey.trim(),
    label: plan.name,
    endpoint: plan.endpoint,
  };
}

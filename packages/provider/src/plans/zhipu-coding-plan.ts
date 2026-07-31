/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Zhipu Coding Plan (智谱) — real source-backed coding plan integration.
 *
 * Upstream source: D:\PLUMB-upstreams\oh-my-pi
 *  - packages/ai/src/registry/zhipu-coding-plan.ts
 *  - packages/ai/src/registry/api-key-login.ts
 *
 * Auth flow: API key paste (<id>.<secret>)
 * Endpoint: https://open.bigmodel.cn/api/coding/paas/v4
 * Model discovery: bundled (glm-5.1, glm-4.7-flash)
 * Transport: openai-completions compatible
 *
 * This is a PRODUCTION_READY coding plan with the complete chain:
 * catalog -> auth -> credential resolution -> endpoint -> model list -> streaming
 */

import {
  type PlumbProvider,
  PlumbProviderCategory,
  type PlumbAuthMethod,
} from '../types.js';

// ─── Provider definition ───────────────────────────────────────────────

export const ZHIPU_CODING_PLAN_PROVIDER: PlumbProvider = {
  id: 'zhipu-coding-plan',
  name: 'Zhipu Coding Plan (智谱 GLM)',
  category: PlumbProviderCategory.CODING_PLAN,
  description:
    'Zhipu BigModel coding plan. Get your API key at bigmodel.cn/coding-plan.',
  authMethods: [
    {
      type: 'api_key',
      promptLabel: 'API Key (<id>.<secret>)',
    } satisfies PlumbAuthMethod,
  ],
  defaultModel: 'glm-5.1',
  envVars: ['ZHIPU_API_KEY'],
  available: true,
  group: 'Coding Plans',
  order: 8,
};

// ─── Endpoint constants ────────────────────────────────────────────────

export const ZHIPU_API_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';
export const ZHIPU_AUTH_URL =
  'https://bigmodel.cn/coding-plan/personal/overview';

// ─── Model list ────────────────────────────────────────────────────────

export const ZHIPU_CODING_PLAN_MODELS = [
  {
    id: 'glm-5.1',
    name: 'GLM-5.1',
    contextWindow: 256000,
    maxTokens: 65536,
    reasoning: true,
    input: 'text' as const,
  },
  {
    id: 'glm-4.7-flash',
    name: 'GLM-4.7 Flash',
    contextWindow: 128000,
    maxTokens: 16384,
    reasoning: false,
    input: 'text' as const,
  },
  {
    id: 'glm-4.7',
    name: 'GLM-4.7',
    contextWindow: 128000,
    maxTokens: 16384,
    reasoning: true,
    input: 'text' as const,
  },
  {
    id: 'glm-4.5-flash',
    name: 'GLM-4.5 Flash',
    contextWindow: 128000,
    maxTokens: 8192,
    reasoning: false,
    input: 'text' as const,
  },
];

// ─── API key validation ────────────────────────────────────────────────

/**
 * Validate a Zhipu coding plan API key against the chat-completions endpoint.
 * Returns the trimmed key if valid, throws if invalid.
 */
export async function validateZhipuCodingPlanKey(
  apiKey: string,
): Promise<string> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error('API key is required.');
  }

  const url = `${ZHIPU_API_BASE_URL}/chat/completions`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trimmed}`,
      },
      body: JSON.stringify({
        model: 'glm-5.1',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new Error(
      `Cannot reach Zhipu API: ${err instanceof Error ? err.message : 'Network error'}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      'Invalid API key. Please check your key at bigmodel.cn/coding-plan.',
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Zhipu API returned ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  return trimmed;
}

// ─── Model discovery ───────────────────────────────────────────────────

/**
 * Discover available models from the Zhipu coding plan endpoint.
 * Falls back to the bundled model list if discovery fails.
 */
export async function discoverZhipuCodingPlanModels(
  _apiKey: string,
): Promise<Array<{ id: string; name?: string }>> {
  // Zhipu coding plan doesn't expose a /models endpoint.
  // Use the verified bundled model list.
  return ZHIPU_CODING_PLAN_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
  }));
}

// ─── Login flow ────────────────────────────────────────────────────────

export interface ZhipuLoginCallbacks {
  onAuthUrl: (url: string) => void;
  onProgress: (message: string) => void;
  onPrompt: (prompt: string, placeholder?: string) => Promise<string>;
}

export interface ZhipuLoginResult {
  type: 'api_key';
  provider: string;
  key: string;
  label: string;
}

/**
 * Interactive login flow for Zhipu coding plan.
 * 1. Opens auth URL (bigmodel.cn coding plan page)
 * 2. Prompts user to paste API key
 * 3. Validates the key
 * 4. Returns the credential
 */
export async function loginZhipuCodingPlan(
  callbacks: ZhipuLoginCallbacks,
): Promise<ZhipuLoginResult> {
  callbacks.onProgress('Opening Zhipu coding plan page...');
  callbacks.onAuthUrl(ZHIPU_AUTH_URL);

  const apiKey = await callbacks.onPrompt(
    'Paste your Zhipu coding plan API key (<id>.<secret>):',
    '<id>.<secret>',
  );

  callbacks.onProgress('Validating API key...');
  const validated = await validateZhipuCodingPlanKey(apiKey);
  callbacks.onProgress('API key validated successfully.');

  return {
    type: 'api_key',
    provider: 'zhipu-coding-plan',
    key: validated,
    label: 'Zhipu Coding Plan',
  };
}

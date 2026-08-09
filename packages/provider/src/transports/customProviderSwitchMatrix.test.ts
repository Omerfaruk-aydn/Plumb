/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 7 custom-provider switch matrix: exercises the real production
 * dispatch chain (plumbModelStream -> the real per-dialect transport)
 * across all three custom-provider dialects in sequence, proving zero
 * credential/header/endpoint/model/dialect bleed between consecutive
 * requests to DIFFERENT custom provider definitions -- each one carries
 * its own baseUrl, credentialPlacement, safeHeaders, and API key, and
 * none of that may survive into the next definition's request.
 *
 * Chain: CUSTOM_OPENAI -> CUSTOM_ANTHROPIC -> CUSTOM_GEMINI -> CUSTOM_OPENAI
 * (closing the loop back to the first definition).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plumbModelStream } from './streaming.js';
import {
  __resetCustomProviderDefinitionsForTests,
  setCustomProviderDefinitions,
  type CustomProviderDefinition,
} from '../config/customProviderDefinitions.js';
import { PlumbModelRegistry } from '../registry/model-registry.js';
import type { PlumbStreamEvent } from '../types.js';

const OPENAI_ID = 'custom:aaaaaaaa-e89b-42d3-a456-426614174000';
const ANTHROPIC_ID = 'custom:bbbbbbbb-e89b-42d3-a456-426614174000';
const GEMINI_ID = 'custom:cccccccc-e89b-42d3-a456-426614174000';

const DEFINITIONS: CustomProviderDefinition[] = [
  {
    version: 1,
    id: OPENAI_ID,
    displayName: 'Custom OpenAI',
    dialect: 'openai-completions',
    baseUrl: 'https://openai-proxy.example.test/v1',
    credentialPlacement: 'bearer',
    safeHeaders: { 'X-Tenant': 'openai-tenant' },
    manualModels: [{ id: 'openai-private-model' }],
  },
  {
    version: 1,
    id: ANTHROPIC_ID,
    displayName: 'Custom Anthropic',
    dialect: 'anthropic-messages',
    baseUrl: 'https://anthropic-proxy.example.test',
    credentialPlacement: 'x-api-key',
    safeHeaders: { 'X-Tenant': 'anthropic-tenant' },
    manualModels: [{ id: 'anthropic-private-model' }],
  },
  {
    version: 1,
    id: GEMINI_ID,
    displayName: 'Custom Gemini',
    dialect: 'google-generative-ai',
    baseUrl: 'https://gemini-proxy.example.test/v1beta',
    credentialPlacement: 'query-key',
    safeHeaders: { 'X-Tenant': 'gemini-tenant' },
    manualModels: [{ id: 'gemini-private-model' }],
  },
];

const API_KEYS: Record<string, string> = {
  [OPENAI_ID]: 'openai-canary-key',
  [ANTHROPIC_ID]: 'anthropic-canary-key',
  [GEMINI_ID]: 'gemini-canary-key',
};

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
}

function header(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

async function drain(
  registry: PlumbModelRegistry,
  providerId: string,
  modelId: string,
): Promise<PlumbStreamEvent[]> {
  const model = registry.findModel(providerId, modelId);
  if (!model) throw new Error(`model not found: ${providerId}/${modelId}`);
  const events: PlumbStreamEvent[] = [];
  for await (const e of plumbModelStream({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    apiKey: API_KEYS[providerId],
  })) {
    events.push(e);
  }
  return events;
}

describe('Phase 7 custom-provider switch matrix (zero cross-definition bleed)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const captured: CapturedRequest[] = [];

  beforeEach(() => {
    captured.length = 0;
    setCustomProviderDefinitions(DEFINITIONS);
    fetchSpy = vi.fn(async (url: unknown, init?: RequestInit) => {
      captured.push({
        url: String(url),
        headers: { ...(init?.headers as Record<string, string>) },
      });
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetCustomProviderDefinitionsForTests();
  });

  it('runs the full CUSTOM_OPENAI -> CUSTOM_ANTHROPIC -> CUSTOM_GEMINI -> CUSTOM_OPENAI chain with zero credential/header/endpoint/model/dialect bleed', async () => {
    const registry = new PlumbModelRegistry();
    registry.hydrateCustomProviderModels();

    const chain: Array<{ providerId: string; modelId: string }> = [
      { providerId: OPENAI_ID, modelId: 'openai-private-model' },
      { providerId: ANTHROPIC_ID, modelId: 'anthropic-private-model' },
      { providerId: GEMINI_ID, modelId: 'gemini-private-model' },
      { providerId: OPENAI_ID, modelId: 'openai-private-model' },
    ];

    for (const step of chain) {
      const events = await drain(registry, step.providerId, step.modelId);
      expect(events.some((e) => e.type === 'error')).toBe(false);
    }

    expect(captured).toHaveLength(4);
    const [req1, req2, req3, req4] = captured;

    // CUSTOM_OPENAI: Bearer auth, its own tenant header, its own endpoint.
    for (const req of [req1, req4]) {
      expect(req.url).toBe(
        'https://openai-proxy.example.test/v1/chat/completions',
      );
      expect(header(req.headers, 'Authorization')).toBe(
        'Bearer openai-canary-key',
      );
      expect(header(req.headers, 'X-Tenant')).toBe('openai-tenant');
      expect(header(req.headers, 'x-api-key')).toBeUndefined();
      expect(JSON.stringify(req.headers)).not.toContain('anthropic-canary');
      expect(JSON.stringify(req.headers)).not.toContain('gemini-canary');
      expect(JSON.stringify(req.headers)).not.toContain('anthropic-tenant');
      expect(JSON.stringify(req.headers)).not.toContain('gemini-tenant');
    }

    // CUSTOM_ANTHROPIC: x-api-key auth, its own tenant header, its own
    // endpoint -- must not inherit CUSTOM_OPENAI's Bearer header or tenant.
    expect(req2.url).toBe('https://anthropic-proxy.example.test/v1/messages');
    expect(header(req2.headers, 'x-api-key')).toBe('anthropic-canary-key');
    expect(header(req2.headers, 'X-Tenant')).toBe('anthropic-tenant');
    expect(header(req2.headers, 'Authorization')).toBeUndefined();
    expect(JSON.stringify(req2.headers)).not.toContain('openai-canary');
    expect(JSON.stringify(req2.headers)).not.toContain('gemini-canary');
    expect(JSON.stringify(req2.headers)).not.toContain('openai-tenant');
    expect(JSON.stringify(req2.headers)).not.toContain('gemini-tenant');

    // CUSTOM_GEMINI: query-key credential (never a header), its own tenant
    // header, its own endpoint -- must not inherit either prior provider's
    // Authorization/x-api-key or tenant.
    expect(req3.url).toBe(
      'https://gemini-proxy.example.test/v1beta/models/gemini-private-model:streamGenerateContent?alt=sse&key=gemini-canary-key',
    );
    expect(header(req3.headers, 'X-Tenant')).toBe('gemini-tenant');
    expect(header(req3.headers, 'Authorization')).toBeUndefined();
    expect(header(req3.headers, 'x-api-key')).toBeUndefined();
    expect(JSON.stringify(req3.headers)).not.toContain('openai-canary');
    expect(JSON.stringify(req3.headers)).not.toContain('anthropic-canary');
    expect(JSON.stringify(req3.headers)).not.toContain('openai-tenant');
    expect(JSON.stringify(req3.headers)).not.toContain('anthropic-tenant');

    // Closing the loop: the second CUSTOM_OPENAI request is identical in
    // shape to the first -- no state accumulated from the two intervening
    // requests to different definitions.
    expect(req4.headers).toEqual(req1.headers);
    expect(req4.url).toBe(req1.url);
  });
});

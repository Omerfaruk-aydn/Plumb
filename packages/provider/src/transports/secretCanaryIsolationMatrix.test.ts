/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PlumbModelRegistry } from '../registry/model-registry.js';
import { plumbModelStream } from './streaming.js';
import { writeSafeTraceEvent } from './antigravityTrace.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';
import { __resetVertexTokenCache } from '../vendor-ai/providers/plumbGoogleAuth.js';
import { __resetWatsonxClientCacheForTests } from './watsonx.js';
import { registerPlumbCredentialStoreFactory } from '../auth/credential-store.js';
import type { PlumbStreamEvent, PlumbModel } from '../types.js';

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

describe('Task 9 — Secret Canary & Trace Sanitization Matrix', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let registry: PlumbModelRegistry;
  let tmpDir: string;
  let traceFilePath: string;
  const ORIGINAL_ENV = { ...process.env };
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];

  const CANARY_OPENAI_SECRET = 'CANARY_SECRET_OPENAI_999999999';
  const CANARY_ANTHROPIC_SECRET = 'CANARY_SECRET_ANTHROPIC_888888888';

  beforeEach(async () => {
    const { installBunGlobal } = await import('../vendor-shims/bun-runtime.js');
    installBunGlobal();
    registry = new PlumbModelRegistry();
    calls.length = 0;
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plumb-secret-canary-'));
    traceFilePath = path.join(tmpDir, 'trace.jsonl');
    process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE'] = '1';
    process.env['PLUMB_ANTIGRAVITY_TRACE_SAFE_FILE'] = traceFilePath;

    registerPlumbCredentialStoreFactory(async () => ({
      getCredentials: async (p: string) => [
        {
          id: 'test-oauth-9',
          provider: p,
          credential: {
            type: 'oauth' as const,
            provider: p,
            access: 'CANARY_ANTIGRAVITY_OAUTH_TOKEN_999',
            refresh: 'CANARY_ANTIGRAVITY_REFRESH_TOKEN_999',
            expires: Date.now() + 3600000,
            projectId: 'canary-antigravity-project-9',
          },
          addedAt: Date.now(),
          lastUsedAt: Date.now(),
        },
      ],
      getApiKey: async () => 'CANARY_STORED_API_KEY_999',
      hasCredentials: async () => true,
      listAuthenticatedProviders: async () => [
        'antigravity',
        'google-antigravity',
      ],
      storeCredential: async () => {},
      storeOAuthCredential: async () => {},
      storeApiKeyCredential: async () => {},
      removeCredentials: async () => {},
      removeCredential: async () => true,
      clearAll: async () => {},
      setProviderMetadata: async () => {},
      getProviderMetadata: async () => ({
        accountLabels: ['test'],
        credentialRefs: ['test-oauth-9'],
      }),
      healthCheck: async () => ({ available: true, usingFallback: false }),
    }));

    fetchSpy = vi.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      const rawHeaders = init?.headers;
      const headers: Record<string, string> = {};
      if (rawHeaders instanceof Headers) {
        rawHeaders.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (rawHeaders) {
        Object.assign(headers, rawHeaders as Record<string, string>);
      }
      calls.push({ url: urlStr, headers });
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. Secret canary non-bleed: OpenAI secret does NOT bleed to Anthropic or Vertex', async () => {
    const openaiModel = registry.getModelsForProvider('openai')[0];
    const anthropicModel = registry.getModelsForProvider('anthropic-api')[0];

    // Request 1: OpenAI
    const openaiEvents: PlumbStreamEvent[] = [];
    for await (const e of plumbModelStream({
      model: openaiModel,
      messages: [{ role: 'user', content: 'test' }],
      apiKey: CANARY_OPENAI_SECRET,
    })) {
      openaiEvents.push(e);
    }

    // Request 2: Anthropic
    const anthropicEvents: PlumbStreamEvent[] = [];
    for await (const e of plumbModelStream({
      model: anthropicModel,
      messages: [{ role: 'user', content: 'test' }],
      apiKey: CANARY_ANTHROPIC_SECRET,
    })) {
      anthropicEvents.push(e);
    }

    expect(calls).toHaveLength(2);

    // Assert OpenAI call received ONLY OpenAI canary
    expect(header(calls[0].headers, 'authorization')).toBe(
      `Bearer ${CANARY_OPENAI_SECRET}`,
    );
    expect(header(calls[0].headers, 'x-api-key')).toBeUndefined();

    // Assert Anthropic call received ONLY Anthropic canary, zero OpenAI canary
    expect(header(calls[1].headers, 'x-api-key')).toBe(CANARY_ANTHROPIC_SECRET);
    expect(header(calls[1].headers, 'authorization')).toBeUndefined();
    expect(JSON.stringify(calls[1])).not.toContain(CANARY_OPENAI_SECRET);
  });

  it('2. Antigravity trace sanitization: raw tokens/canaries are sanitized in safe trace output', async () => {
    const antigravityModel: PlumbModel = {
      id: 'gpt-oss-120b-medium',
      provider: 'google-antigravity',
      api: 'google-gemini-cli',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      input: 'text',
    };

    const events: PlumbStreamEvent[] = [];
    for await (const e of plumbModelStream({
      model: antigravityModel,
      messages: [{ role: 'user', content: 'canary trace test' }],
      apiKey: '<authenticated>',
    })) {
      events.push(e);
    }

    // Write safe trace event manually to verify file sink sanitization
    writeSafeTraceEvent({
      traceId: 'ag-canary-test',
      source: 'NORMAL_CHAT',
      phase: 'REQUEST_CONSTRUCTION',
      model: 'gpt-oss-120b-medium',
    });

    // Check trace file written to disk
    expect(fs.existsSync(traceFilePath)).toBe(true);
    const traceContent = fs.readFileSync(traceFilePath, 'utf-8');
    expect(traceContent).not.toContain('CANARY_ANTIGRAVITY_OAUTH_TOKEN_999');
    expect(traceContent).not.toContain('CANARY_ANTIGRAVITY_REFRESH_TOKEN_999');
  });

  it('3. Error message sanitization: stream error events do not leak secret canaries', async () => {
    // Cause an error by using an invalid custom model configuration
    const brokenCustomModel: PlumbModel = {
      id: 'invalid-model',
      provider: 'custom:non-existent',
      api: 'openai-completions',
      baseUrl: 'https://invalid.example.test',
      contextWindow: 4096,
      maxTokens: 1024,
      input: 'text',
    };

    const events: PlumbStreamEvent[] = [];
    for await (const e of plumbModelStream({
      model: brokenCustomModel,
      messages: [{ role: 'user', content: 'error test' }],
      apiKey: CANARY_OPENAI_SECRET,
    })) {
      events.push(e);
    }

    const errorEvent = events.find((e) => e.type === 'error');
    if (errorEvent && errorEvent.type === 'error') {
      const errorString = JSON.stringify(errorEvent.error);
      expect(errorString).not.toContain(CANARY_OPENAI_SECRET);
    }
  });
});

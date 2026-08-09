/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCustomProviderDefinitionsForTests,
  upsertCustomProviderDefinition,
} from '../config/customProviderDefinitions.js';
import { discoverProviderModelsDetailed } from './model-discovery.js';

const OPENAI_ID = 'custom:123e4567-e89b-42d3-a456-426614174000';
const ANTHROPIC_ID = 'custom:223e4567-e89b-42d3-a456-426614174000';
const GEMINI_ID = 'custom:323e4567-e89b-42d3-a456-426614174000';

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
}

function stubFetch(
  respond: () => Response | Promise<Response>,
): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    captured.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return respond();
  }) as unknown as typeof fetch;
  return captured;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('custom provider model discovery', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    __resetCustomProviderDefinitionsForTests();
  });

  it('lists an OpenAI-compatible endpoint and marks the result SERVER_DYNAMIC', async () => {
    upsertCustomProviderDefinition({
      id: OPENAI_ID,
      displayName: 'OpenAI proxy',
      dialect: 'openai-completions',
      baseUrl: 'https://openai.example.test/v1',
      credentialPlacement: 'bearer',
      safeHeaders: { 'X-Tenant': 'acme' },
    });
    const captured = stubFetch(() =>
      json({ data: [{ id: 'private-a' }, { id: 'private-b' }] }),
    );

    const outcome = await discoverProviderModelsDetailed(OPENAI_ID, {
      providerId: OPENAI_ID,
      apiKey: 'openai-canary',
    });

    expect(captured[0].url).toBe('https://openai.example.test/v1/models');
    expect(captured[0].headers['Authorization']).toBe('Bearer openai-canary');
    expect(captured[0].headers['X-Tenant']).toBe('acme');
    expect(captured[0].headers['x-api-key']).toBeUndefined();
    expect(outcome.status).toBe('success');
    expect(outcome.models).toMatchObject([
      {
        id: 'private-a',
        api: 'openai-completions',
        baseUrl: 'https://openai.example.test/v1',
        source: 'SERVER_DYNAMIC',
      },
      { id: 'private-b', source: 'SERVER_DYNAMIC' },
    ]);
  });

  it('lists an Anthropic-compatible endpoint with x-api-key and the version header', async () => {
    upsertCustomProviderDefinition({
      id: ANTHROPIC_ID,
      displayName: 'Anthropic proxy',
      dialect: 'anthropic-messages',
      baseUrl: 'https://anthropic.example.test',
    });
    const captured = stubFetch(() =>
      json({ data: [{ id: 'claude-private' }] }),
    );

    const outcome = await discoverProviderModelsDetailed(ANTHROPIC_ID, {
      providerId: ANTHROPIC_ID,
      apiKey: 'anthropic-canary',
    });

    expect(captured[0].url).toBe('https://anthropic.example.test/v1/models');
    expect(captured[0].headers['x-api-key']).toBe('anthropic-canary');
    expect(captured[0].headers['anthropic-version']).toBe('2023-06-01');
    expect(captured[0].headers['Authorization']).toBeUndefined();
    expect(outcome.models).toMatchObject([
      { id: 'claude-private', api: 'anthropic-messages' },
    ]);
  });

  it('lists a Gemini-compatible endpoint via an encoded query key, never a header', async () => {
    upsertCustomProviderDefinition({
      id: GEMINI_ID,
      displayName: 'Gemini proxy',
      dialect: 'google-generative-ai',
      baseUrl: 'https://gemini.example.test/v1beta',
    });
    const captured = stubFetch(() =>
      json({ models: [{ name: 'models/gemini-private' }] }),
    );

    const outcome = await discoverProviderModelsDetailed(GEMINI_ID, {
      providerId: GEMINI_ID,
      apiKey: 'query key/+',
    });

    expect(captured[0].url).toBe(
      'https://gemini.example.test/v1beta/models?key=query%20key%2F%2B',
    );
    expect(JSON.stringify(captured[0].headers)).not.toContain('query key');
    // Gemini reports `models/<id>`; PLUMB stores the wire id it will send.
    expect(outcome.models).toMatchObject([
      { id: 'gemini-private', api: 'google-generative-ai' },
    ]);
  });

  it('classifies an unreachable endpoint as unavailable and invents no models', async () => {
    upsertCustomProviderDefinition({
      id: OPENAI_ID,
      displayName: 'Offline proxy',
      dialect: 'openai-completions',
      baseUrl: 'https://offline.example.test/v1',
      manualModels: [{ id: 'manual-only' }],
    });
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });

    const outcome = await discoverProviderModelsDetailed(OPENAI_ID, {
      providerId: OPENAI_ID,
      apiKey: 'k',
    });

    expect(outcome.status).toBe('unavailable');
    expect(outcome.errorCode).toBe('SERVER_UNAVAILABLE');
    // The manual model stays USER_CONFIGURED in the registry; discovery must
    // never re-label it as something the server reported.
    expect(outcome.models).toEqual([]);
  });

  it('separates authentication failure from an endpoint that has no listing route', async () => {
    upsertCustomProviderDefinition({
      id: OPENAI_ID,
      displayName: 'Proxy',
      dialect: 'openai-completions',
      baseUrl: 'https://proxy.example.test/v1',
    });

    stubFetch(() => json({ error: 'nope' }, 401));
    await expect(
      discoverProviderModelsDetailed(OPENAI_ID, {
        providerId: OPENAI_ID,
        apiKey: 'k',
      }),
    ).resolves.toMatchObject({
      status: 'error',
      errorCode: 'DISCOVERY_AUTH_FAILED',
    });

    stubFetch(() => json({ error: 'not found' }, 404));
    await expect(
      discoverProviderModelsDetailed(OPENAI_ID, {
        providerId: OPENAI_ID,
        apiKey: 'k',
      }),
    ).resolves.toMatchObject({
      status: 'error',
      errorCode: 'DISCOVERY_HTTP_ERROR',
    });
  });

  it('reports a protocol error rather than an empty list for an unrecognizable body', async () => {
    upsertCustomProviderDefinition({
      id: OPENAI_ID,
      displayName: 'Proxy',
      dialect: 'openai-completions',
      baseUrl: 'https://proxy.example.test/v1',
    });
    stubFetch(() => json({ unexpected: true }));

    await expect(
      discoverProviderModelsDetailed(OPENAI_ID, {
        providerId: OPENAI_ID,
        apiKey: 'k',
      }),
    ).resolves.toMatchObject({
      status: 'error',
      errorCode: 'DISCOVERY_PROTOCOL_ERROR',
    });
  });

  it('serves an edited base URL immediately, never a stale adapter', async () => {
    upsertCustomProviderDefinition({
      id: OPENAI_ID,
      displayName: 'Proxy',
      dialect: 'openai-completions',
      baseUrl: 'https://old.example.test/v1',
    });
    const captured = stubFetch(() => json({ data: [] }));
    await discoverProviderModelsDetailed(OPENAI_ID, {
      providerId: OPENAI_ID,
      apiKey: 'k',
    });

    upsertCustomProviderDefinition({
      id: OPENAI_ID,
      displayName: 'Proxy',
      dialect: 'openai-completions',
      baseUrl: 'https://new.example.test/v1',
    });
    await discoverProviderModelsDetailed(OPENAI_ID, {
      providerId: OPENAI_ID,
      apiKey: 'k',
    });

    expect(captured.map((request) => request.url)).toEqual([
      'https://old.example.test/v1/models',
      'https://new.example.test/v1/models',
    ]);
  });
});

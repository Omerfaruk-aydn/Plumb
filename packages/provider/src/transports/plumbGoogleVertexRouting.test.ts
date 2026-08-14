/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { plumbModelStream } from './streaming.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';
import { __resetVertexTokenCache } from '../vendor-ai/providers/plumbGoogleAuth.js';
import type { PlumbStreamEvent } from '../types.js';

describe('google-vertex routing (production-shaped, no mocking of streaming.ts/model-catalog.ts)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    const { installBunGlobal } = await import('../vendor-shims/bun-runtime.js');
    installBunGlobal();
    process.env['GOOGLE_CLOUD_PROJECT'] = 'plumb-test-project';
    process.env['GOOGLE_CLOUD_LOCATION'] = 'us-central1';
    process.env['GOOGLE_CLOUD_ACCESS_TOKEN'] = 'real-vertex-oauth-token';
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
    __resetVertexTokenCache();
  });

  it('native Gemini-on-Vertex: reaches the real regional project/location-scoped path with a Bearer token, never ?key=', async () => {
    const models = getCatalogModels('google-vertex');
    const model = models.find((m) => m.api === 'google-vertex');
    expect(model).toBeDefined();
    expect(model!.baseUrl).toContain('{location}');

    fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const events: PlumbStreamEvent[] = [];
    const stream = plumbModelStream({
      model: model!,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '<authenticated>',
    });
    for await (const e of stream) events.push(e);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://us-central1-aiplatform.googleapis.com/v1/projects/plumb-test-project/locations/us-central1/publishers/google/models/${model!.id}:streamGenerateContent?alt=sse`,
    );
    expect(url).not.toContain('{location}');
    expect(url).not.toContain('{project}');
    expect(url).not.toContain('key=');

    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer real-vertex-oauth-token');
  });

  it('Claude-on-Vertex: reaches the real streamRawPredict URL (never .../v1/messages) with vertex_anthropic body shape and a Bearer token, never x-api-key', async () => {
    const models = getCatalogModels('google-vertex');
    const model = models.find((m) => m.api === 'anthropic-messages');
    expect(model).toBeDefined();
    expect(model!.baseUrl).toContain('{location}');
    expect(model!.baseUrl).toContain(':streamRawPredict');

    fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response('event: done\ndata: {}\n\n', { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const events: PlumbStreamEvent[] = [];
    const stream = plumbModelStream({
      model: model!,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '<authenticated>',
    });
    for await (const e of stream) events.push(e);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/plumb-test-project/locations/us-central1/publishers/anthropic/models/',
    );
    expect(url.endsWith(':streamRawPredict')).toBe(true);
    expect(url).not.toContain('/v1/messages');
    expect(url).not.toContain('{location}');
    expect(url).not.toContain('{project}');

    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer real-vertex-oauth-token');
    expect(headers['x-api-key']).toBeUndefined();

    const body = JSON.parse(init.body as string);
    expect(body.model).toBeUndefined();
    expect(body.anthropic_version).toBe('vertex-2023-10-16');
  });

  it('without GOOGLE_CLOUD_PROJECT configured, fails with a safe error instead of resolving a literal {project} hostname', async () => {
    delete process.env['GOOGLE_CLOUD_PROJECT'];
    const models = getCatalogModels('google-vertex');
    const model = models.find((m) => m.api === 'google-vertex');

    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const events: PlumbStreamEvent[] = [];
    const stream = plumbModelStream({
      model: model!,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '<authenticated>',
    });
    for await (const e of stream) events.push(e);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      events.some(
        (e) =>
          e.type === 'error' &&
          (e.error?.code === 'CONFIGURATION_REQUIRED' ||
            e.error?.code === 'INVALID_REQUEST'),
      ),
    ).toBe(true);
  });
});

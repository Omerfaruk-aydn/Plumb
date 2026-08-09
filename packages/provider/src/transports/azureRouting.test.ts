/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production-shaped regression: selecting provider = 'azure' must reach the
 * real Azure OpenAI Responses API (catalog/model-catalog.ts ->
 * transports/streaming.ts's plumbModelStream -> the registered
 * 'azure-openai-responses' transport), with the real resolved endpoint,
 * deployment identity, and `api-key` header -- never the generic
 * `{baseUrl}/chat/completions` OpenAI-compatible passthrough (which, given
 * the catalog's deliberately empty `baseUrl`, would previously have sent a
 * malformed relative-path request).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { plumbModelStream } from './streaming.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';
import type { PlumbStreamEvent } from '../types.js';

function sseChunk(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

describe('azure routing (production-shaped, no mocking of streaming.ts/model-catalog.ts)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env['AZURE_OPENAI_RESOURCE_NAME'] = 'plumb-test-resource';
    delete process.env['AZURE_OPENAI_BASE_URL'];
    delete process.env['AZURE_OPENAI_DEPLOYMENT_NAME_MAP'];
    delete process.env['AZURE_OPENAI_API_VERSION'];
    setProviderConfigResolver(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it('sends the request to the real Responses API endpoint (never /chat/completions) with the api-key header', async () => {
    const [model] = getCatalogModels('azure');
    expect(model).toBeDefined();
    expect(model!.api).toBe('azure-openai-responses');
    expect(model!.baseUrl).toBe(''); // catalog deliberately leaves this empty

    fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response(
          sseChunk({ type: 'response.output_text.delta', delta: 'hi' }) +
            sseChunk({ type: 'response.completed', response: { output: [] } }) +
            'data: [DONE]\n\n',
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const events: PlumbStreamEvent[] = [];
    const stream = plumbModelStream({
      model: model!,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'real-azure-key',
    });
    for await (const e of stream) events.push(e);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      'https://plumb-test-resource.openai.azure.com/openai/v1/responses?api-version=v1',
    );
    expect(url).not.toContain('/chat/completions');

    const headers = init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('real-azure-key');
    expect(headers['Authorization']).toBeUndefined();

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(model!.id); // no deployment map configured -> falls back to model id
    expect(body.input).toEqual([{ role: 'user', content: 'hi' }]);

    expect(events.some((e) => e.type === 'text' && e.text === 'hi')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('a configured deployment name map resolves the real wire deployment identity, not the catalog model id', async () => {
    process.env['AZURE_OPENAI_DEPLOYMENT_NAME_MAP'] =
      'codex-mini=my-real-deployment';
    const [model] = getCatalogModels('azure');

    fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const stream = plumbModelStream({
      model: model!,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
    });
    for await (const _e of stream) {
      // drain
    }

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('my-real-deployment');
  });

  it('PLUMB-saved config (resourceName) beats the environment variable, matching canonical precedence', async () => {
    setProviderConfigResolver((providerId) =>
      providerId === 'azure'
        ? { resourceName: 'plumb-saved-resource' }
        : ({} as Record<string, string>),
    );
    const [model] = getCatalogModels('azure');

    fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const stream = plumbModelStream({
      model: model!,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
    });
    for await (const _e of stream) {
      // drain
    }

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('plumb-saved-resource.openai.azure.com');
  });

  it('with no resource/base URL configured at all, fails with a safe CONFIGURATION_REQUIRED-style error instead of a malformed relative-path request', async () => {
    delete process.env['AZURE_OPENAI_RESOURCE_NAME'];
    const [model] = getCatalogModels('azure');

    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const events: PlumbStreamEvent[] = [];
    const stream = plumbModelStream({
      model: model!,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
    });
    for await (const e of stream) events.push(e);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      events.some(
        (e) => e.type === 'error' && e.error?.code === 'INVALID_REQUEST',
      ),
    ).toBe(true);
  });
});

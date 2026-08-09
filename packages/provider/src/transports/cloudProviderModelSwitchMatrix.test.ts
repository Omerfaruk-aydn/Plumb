/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 4 cloud model-switch matrix: for Bedrock, Azure, and Vertex,
 * proves selecting model A, then B, then A again produces zero stale
 * wire-model/deployment/endpoint/dialect state -- request N+1 never
 * carries anything left over from request N.
 *
 * cloudProviderSwitchMatrix.test.ts already has a MODEL_SWITCH-labeled
 * test, but it exercises a CONFIG change (AWS_REGION) on the same model,
 * not switching between two actual different models -- that invariant
 * (select model A, request; select model B, request; select model A
 * again, request; assert zero stale identity) was previously unproven
 * for every cloud provider.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { plumbModelStream } from './streaming.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';
import { __resetVertexTokenCache } from '../omp-ai/providers/google-auth.js';
import type { PlumbStreamEvent } from '../types.js';

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
  model: ReturnType<typeof getCatalogModels>[number],
  apiKey: string,
): Promise<PlumbStreamEvent[]> {
  const events: PlumbStreamEvent[] = [];
  for await (const e of plumbModelStream({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    apiKey,
  })) {
    events.push(e);
  }
  return events;
}

describe('Phase 4 cloud model-switch matrix (A -> B -> A, zero stale identity)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const ORIGINAL_ENV = { ...process.env };
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
    body: string;
  }> = [];

  beforeEach(async () => {
    const { installBunGlobal } = await import('../omp-shims/bun-runtime.js');
    installBunGlobal();
    calls.length = 0;
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();

    process.env['AWS_ACCESS_KEY_ID'] = 'AKIAMODELSWITCHTEST00';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'model-switch-test-secret-000000';
    process.env['AWS_REGION'] = 'us-east-1';
    process.env['AZURE_OPENAI_RESOURCE_NAME'] = 'plumb-switch-resource';
    process.env['GOOGLE_CLOUD_PROJECT'] = 'plumb-switch-project';
    process.env['GOOGLE_CLOUD_LOCATION'] = 'us-central1';
    process.env['GOOGLE_CLOUD_ACCESS_TOKEN'] = 'plumb-switch-vertex-token';

    fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const rawHeaders = init?.headers;
      const headers: Record<string, string> = {};
      if (rawHeaders instanceof Headers) {
        rawHeaders.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (rawHeaders) {
        Object.assign(headers, rawHeaders as Record<string, string>);
      }
      calls.push({
        url,
        headers,
        body: typeof init?.body === 'string' ? init.body : '',
      });
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
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
  });

  it('BEDROCK: switching wire model A -> B -> A carries zero stale model id', async () => {
    const models = getCatalogModels('amazon-bedrock');
    const modelA = models.find((m) => m.id.includes('haiku'))!;
    const modelB = models.find((m) => m.id.includes('opus'))!;
    expect(modelA.id).not.toBe(modelB.id);

    await drain(modelA, '<authenticated>');
    expect(calls[0].url).toContain(encodeURIComponent(modelA.id));
    expect(calls[0].url).not.toContain(encodeURIComponent(modelB.id));

    await drain(modelB, '<authenticated>');
    expect(calls[1].url).toContain(encodeURIComponent(modelB.id));
    expect(calls[1].url).not.toContain(encodeURIComponent(modelA.id));

    await drain(modelA, '<authenticated>');
    expect(calls[2].url).toContain(encodeURIComponent(modelA.id));
    expect(calls[2].url).not.toContain(encodeURIComponent(modelB.id));
  });

  it('AZURE: switching deployment A -> B -> A via the PLUMB deployment map carries zero stale deployment', async () => {
    const models = getCatalogModels('azure');
    const modelA = models.find((m) => m.id === 'gpt-4')!;
    const modelB = models.find((m) => m.id === 'gpt-4-turbo')!;
    expect(modelA).toBeDefined();
    expect(modelB).toBeDefined();

    setProviderConfigResolver((providerId) =>
      providerId === 'azure'
        ? {
            resourceName: 'plumb-switch-resource',
            deploymentMap: `${modelA.id}=deployment-a,${modelB.id}=deployment-b`,
          }
        : ({} as Record<string, string>),
    );

    await drain(modelA, 'k');
    expect(JSON.parse(calls[0].body).model).toBe('deployment-a');

    await drain(modelB, 'k');
    expect(JSON.parse(calls[1].body).model).toBe('deployment-b');
    expect(JSON.parse(calls[1].body).model).not.toBe('deployment-a');

    await drain(modelA, 'k');
    expect(JSON.parse(calls[2].body).model).toBe('deployment-a');
    expect(JSON.parse(calls[2].body).model).not.toBe('deployment-b');
  });

  it('VERTEX: switching across dialect families (Claude -> Gemini -> Claude on Vertex) carries zero stale dialect/endpoint', async () => {
    const models = getCatalogModels('google-vertex');
    const claudeModel = models.find((m) => m.api === 'anthropic-messages')!;
    const geminiModel = models.find((m) => m.api === 'google-vertex')!;
    expect(claudeModel).toBeDefined();
    expect(geminiModel).toBeDefined();

    // 1. Claude-on-Vertex
    await drain(claudeModel, '<authenticated>');
    expect(calls[0].url).toContain('anthropic');
    expect(calls[0].url).toContain(':streamRawPredict');
    expect(header(calls[0].headers, 'authorization')).toBe(
      'Bearer plumb-switch-vertex-token',
    );
    expect(header(calls[0].headers, 'x-api-key')).toBeUndefined();

    // 2. Gemini-on-Vertex -- must carry none of Claude's path shape/dialect.
    await drain(geminiModel, '<authenticated>');
    expect(calls[1].url).not.toContain('anthropic');
    expect(calls[1].url).not.toContain(':streamRawPredict');
    expect(calls[1].url).toContain(encodeURIComponent(geminiModel.id));

    // 3. Back to Claude -- proves no sticky Gemini dialect/session state.
    await drain(claudeModel, '<authenticated>');
    expect(calls[2].url).toContain('anthropic');
    expect(calls[2].url).toContain(':streamRawPredict');
    expect(header(calls[2].headers, 'authorization')).toBe(
      'Bearer plumb-switch-vertex-token',
    );
    expect(header(calls[2].headers, 'x-api-key')).toBeUndefined();
  });
});

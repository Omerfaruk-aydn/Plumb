/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { plumbModelStream } from './streaming.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';
import { __resetVertexTokenCache } from '../vendor-ai/providers/plumbGoogleAuth.js';
import { __resetWatsonxClientCacheForTests } from './watsonx.js';
import type { PlumbStreamEvent } from '../types.js';

const mockTextChatStream = vi.fn();
vi.mock('@ibm-cloud/watsonx-ai', () => ({
  WatsonXAI: {
    newInstance: () => ({
      textChatStream: (...a: unknown[]) => mockTextChatStream(...a),
    }),
  },
}));
vi.mock('ibm-cloud-sdk-core', () => ({
  IamAuthenticator: class {},
}));

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

/** Simulates initializeProviderCloudConfigCache's contract: a resolver
 * that only ever answers for the one provider it was "loaded" for. */
function freshResolverFor(providerId: string, config: Record<string, string>) {
  return (id: string) => (id === providerId ? config : {});
}

describe('Phase 4 cloud provider cold-start matrix (request #1 is already correct)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const ORIGINAL_ENV = { ...process.env };
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
    body: string;
  }> = [];

  beforeEach(async () => {
    const { installBunGlobal } = await import('../vendor-shims/bun-runtime.js');
    installBunGlobal();
    calls.length = 0;
    mockTextChatStream.mockReset();
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();

    // No provider-specific env vars: any correct value in request #1 must
    // have come from the resolver, never a coincidental env fallback.
    for (const key of [
      'AWS_REGION',
      'AWS_DEFAULT_REGION',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_BEARER_TOKEN_BEDROCK',
      'AZURE_OPENAI_RESOURCE_NAME',
      'AZURE_OPENAI_BASE_URL',
      'AZURE_OPENAI_DEPLOYMENT_NAME_MAP',
      'GOOGLE_CLOUD_PROJECT',
      'GOOGLE_CLOUD_LOCATION',
      'GOOGLE_CLOUD_ACCESS_TOKEN',
      'WATSONX_PROJECT_ID',
      'WATSONX_SPACE_ID',
      'WATSONX_REGION',
    ]) {
      delete process.env[key];
    }
    // Bedrock's SigV4 signer needs *some* AWS credential to sign with --
    // the test is about REGION coming from the resolver, not credential
    // sourcing (already covered elsewhere).
    process.env['AWS_ACCESS_KEY_ID'] = 'AKIACOLDSTARTTESTKEY0';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'cold-start-test-secret-000000000';

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
    // Mutate process.env in place rather than reassigning the object:
    // installBunGlobal() (idempotent, only installs once per worker
    // process) captures a live reference to *this* process.env object for
    // Bun.env -- a later `process.env = {...}` reassignment in this or
    // any other test file sharing the worker silently detaches Bun.env
    // from the real environment, breaking every subsequent test that
    // reads env vars through the Bun shim (e.g. Vertex's ADC token
    // resolution, which checks Bun.env.GOOGLE_CLOUD_ACCESS_TOKEN).
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();
  });

  it('BEDROCK: request #1 uses the persisted region, not the wired us-east-1 default', async () => {
    const [model] = getCatalogModels('amazon-bedrock');

    setProviderConfigResolver(
      freshResolverFor('amazon-bedrock', { region: 'ap-southeast-2' }),
    );
    await drain(model, '<authenticated>');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toContain(
      'bedrock-runtime.ap-southeast-2.amazonaws.com',
    );
    expect(header(calls[0].headers, 'authorization')).toMatch(
      /^AWS4-HMAC-SHA256 /,
    );

    // Anti-tautology: no resolver installed -> falls back to the default
    // region instead of coincidentally matching ap-southeast-2.
    setProviderConfigResolver(undefined);
    await drain(model, '<authenticated>');
    expect(calls[1].url).toContain('bedrock-runtime.us-east-1.amazonaws.com');
    expect(calls[1].url).not.toContain('ap-southeast-2');
  });

  it('AZURE: request #1 uses the persisted resourceName/deploymentMap, no restart required', async () => {
    const [model] = getCatalogModels('azure');

    setProviderConfigResolver(
      freshResolverFor('azure', {
        resourceName: 'cold-start-resource',
        deploymentMap: `${model.id}=cold-start-deployment`,
      }),
    );
    await drain(model, 'real-azure-key');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toContain('cold-start-resource.openai.azure.com');
    // The Responses API carries the resolved deployment name in the
    // request body's `model` field, not the URL path.
    expect(JSON.parse(calls[0].body).model).toBe('cold-start-deployment');
    expect(header(calls[0].headers, 'api-key')).toBe('real-azure-key');
    expect(header(calls[0].headers, 'authorization')).toBeUndefined();

    // Anti-tautology: without a resolver, azure.ts has nothing to resolve
    // a resourceName from (no env var set either) and the request must
    // fail closed rather than silently reach a real Azure host.
    setProviderConfigResolver(undefined);
    const events = await drain(model, 'real-azure-key');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // unchanged -- no 2nd fetch
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('VERTEX: request #1 uses the persisted project/location, not an unresolved {project}/{location} placeholder', async () => {
    const vertexModels = getCatalogModels('google-vertex');
    const model = vertexModels.find((m) => m.api === 'anthropic-messages')!;

    // Vertex resolves its OAuth bearer token via ADC/getVertexAccessToken,
    // a concern this test deliberately does not exercise (already covered
    // by the switch-matrix test's "never x-api-key" assertion) -- setting
    // this env var bypasses the real GCE metadata-server ADC network call
    // so the test isolates project/location resolution, this test's focus.
    process.env['GOOGLE_CLOUD_ACCESS_TOKEN'] = 'cold-start-vertex-token';
    setProviderConfigResolver(
      freshResolverFor('google-vertex', {
        project: 'cold-start-project',
        location: 'europe-west4',
      }),
    );
    await drain(model, '<authenticated>');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toContain('cold-start-project');
    expect(calls[0].url).toContain('europe-west4-aiplatform.googleapis.com');
    expect(calls[0].url).not.toContain('{project}');
    expect(calls[0].url).not.toContain('{location}');
    expect(header(calls[0].headers, 'authorization')).toBe(
      'Bearer cold-start-vertex-token',
    );
    expect(header(calls[0].headers, 'x-api-key')).toBeUndefined();

    // Anti-tautology: without the resolver and no project/location env
    // var, there is nothing to resolve either from -- the request must
    // fail closed rather than coincidentally reaching the persisted
    // values another way.
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    const events = await drain(model, '<authenticated>');
    if (calls[1]) {
      expect(calls[1].url).not.toContain('cold-start-project');
      expect(calls[1].url).not.toContain('europe-west4');
    } else {
      expect(events.some((e) => e.type === 'error')).toBe(true);
    }
  });

  it('WATSONX: request #1 uses the persisted projectId, routed through the real SDK on the very first call', async () => {
    const [model] = getCatalogModels('watsonx');

    setProviderConfigResolver(
      freshResolverFor('watsonx', { projectId: 'cold-start-watsonx-proj' }),
    );
    mockTextChatStream.mockResolvedValue(
      (async function* () {
        yield { data: { choices: [{ delta: { content: 'hi' } }] } };
      })(),
    );
    await drain(model, 'ibm-cloud-key');
    expect(mockTextChatStream).toHaveBeenCalledTimes(1);
    const callArgs = mockTextChatStream.mock.calls[0][0] as {
      projectId?: string;
    };
    expect(callArgs.projectId).toBe('cold-start-watsonx-proj');
    expect(fetchSpy).not.toHaveBeenCalled(); // watsonx never uses fetch directly

    // Anti-tautology: without a resolver and no WATSONX_PROJECT_ID/
    // WATSONX_SPACE_ID env var, the request must fail closed instead of
    // silently reaching the SDK with an undefined project.
    setProviderConfigResolver(undefined);
    mockTextChatStream.mockClear();
    const events = await drain(model, 'ibm-cloud-key');
    expect(mockTextChatStream).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
});

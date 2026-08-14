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

/** Case-insensitive header lookup -- different transports pass a plain
 * object or a real Headers instance, and casing conventions differ
 * (`api-key` vs `Authorization`), so tests must not depend on which. */
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

describe('Phase 4 cloud provider-switch matrix (zero cross-provider bleed)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const ORIGINAL_ENV = { ...process.env };
  const calls: Array<{
    provider: string;
    url: string;
    headers: Record<string, string>;
  }> = [];

  beforeEach(async () => {
    const { installBunGlobal } = await import('../vendor-shims/bun-runtime.js');
    installBunGlobal();
    calls.length = 0;
    mockTextChatStream.mockReset();
    setProviderConfigResolver(undefined);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();

    process.env['AWS_ACCESS_KEY_ID'] = 'AKIATESTTESTTESTTEST';
    process.env['AWS_SECRET_ACCESS_KEY'] =
      'test-secret-access-key-value-00000000';
    process.env['AWS_REGION'] = 'us-east-1';
    delete process.env['AWS_BEARER_TOKEN_BEDROCK'];
    process.env['AZURE_OPENAI_RESOURCE_NAME'] = 'plumb-test-resource';
    delete process.env['AZURE_OPENAI_BASE_URL'];
    delete process.env['AZURE_OPENAI_DEPLOYMENT_NAME_MAP'];
    process.env['GOOGLE_CLOUD_PROJECT'] = 'plumb-test-project';
    process.env['GOOGLE_CLOUD_LOCATION'] = 'us-central1';
    process.env['GOOGLE_CLOUD_ACCESS_TOKEN'] = 'real-vertex-oauth-token';
    process.env['WATSONX_PROJECT_ID'] = 'watsonx-proj-1';
    process.env['OCI_REGION'] = 'us-chicago-1';
    process.env['OCI_COMPARTMENT_ID'] = 'ocid1.compartment.oc1..real';

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
      calls.push({ provider: 'unlabeled', url, headers });
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
    // Bun.env -- a later `process.env = {...}` reassignment here would
    // silently detach Bun.env from the real environment for the rest of
    // the worker process, breaking anything reading env vars through the
    // Bun shim afterward (e.g. Vertex's ADC token resolution).
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
    __resetVertexTokenCache();
    __resetWatsonxClientCacheForTests();
  });

  it('runs the full Bedrock -> Azure -> Vertex -> watsonx -> OCI -> Bedrock chain with zero credential/config/transport/signer bleed', async () => {
    const [bedrockModel] = getCatalogModels('amazon-bedrock');
    const [azureModel] = getCatalogModels('azure');
    const vertexModels = getCatalogModels('google-vertex');
    const vertexModel = vertexModels.find(
      (m) => m.api === 'anthropic-messages',
    )!;
    const [watsonxModel] = getCatalogModels('watsonx');
    const [ociModel] = getCatalogModels('oci-genai');

    // 1. Bedrock
    await drain(bedrockModel, '<authenticated>');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const bedrockCall = calls[0];
    expect(bedrockCall.url).toContain(
      'bedrock-runtime.us-east-1.amazonaws.com',
    );
    expect(header(bedrockCall.headers, 'authorization')).toMatch(
      /^AWS4-HMAC-SHA256 /,
    );
    expect(header(bedrockCall.headers, 'api-key')).toBeUndefined();
    expect(header(bedrockCall.headers, 'x-api-key')).toBeUndefined();

    // 2. Azure -- must carry none of Bedrock's SigV4 signature/host.
    mockTextChatStream.mockClear();
    await drain(azureModel, 'real-azure-key');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const azureCall = calls[1];
    expect(azureCall.url).toContain('plumb-test-resource.openai.azure.com');
    expect(azureCall.url).not.toContain('amazonaws.com');
    expect(header(azureCall.headers, 'api-key')).toBe('real-azure-key');
    expect(header(azureCall.headers, 'authorization')).toBeUndefined(); // no leaked SigV4/Bearer

    // 3. Vertex -- must carry none of Azure's api-key or Bedrock's SigV4.
    await drain(vertexModel, '<authenticated>');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const vertexCall = calls[2];
    expect(vertexCall.url).toContain('us-central1-aiplatform.googleapis.com');
    expect(vertexCall.url).not.toContain('azure.com');
    expect(vertexCall.url).not.toContain('amazonaws.com');
    expect(header(vertexCall.headers, 'authorization')).toBe(
      'Bearer real-vertex-oauth-token',
    );
    expect(header(vertexCall.headers, 'api-key')).toBeUndefined();
    expect(header(vertexCall.headers, 'x-api-key')).toBeUndefined();

    // 4. watsonx -- routed entirely through the official SDK, never fetch.
    mockTextChatStream.mockResolvedValue(
      (async function* () {
        yield { data: { choices: [{ delta: { content: 'hi' } }] } };
      })(),
    );
    await drain(watsonxModel, 'ibm-cloud-key');
    expect(fetchSpy).toHaveBeenCalledTimes(3); // unchanged -- watsonx never calls fetch
    expect(mockTextChatStream).toHaveBeenCalledTimes(1);
    const watsonxCallArgs = mockTextChatStream.mock.calls[0][0] as {
      projectId?: string;
    };
    expect(watsonxCallArgs.projectId).toBe('watsonx-proj-1');

    // 5. OCI -- must carry none of the prior providers' hosts/auth schemes.
    await drain(ociModel, 'real-oci-genai-key');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    const ociCall = calls[3];
    expect(ociCall.url).toContain(
      'inference.generativeai.us-chicago-1.oci.oraclecloud.com',
    );
    expect(ociCall.url).not.toContain('azure.com');
    expect(ociCall.url).not.toContain('amazonaws.com');
    expect(ociCall.url).not.toContain('aiplatform.googleapis.com');
    expect(header(ociCall.headers, 'authorization')).toBe(
      'Bearer real-oci-genai-key',
    );
    expect(header(ociCall.headers, 'opc-compartment-id')).toBe(
      'ocid1.compartment.oc1..real',
    );
    expect(header(ociCall.headers, 'api-key')).toBeUndefined();

    // 6. Back to Bedrock -- proves the chain doesn't leave sticky state
    // (cached Vertex token, cached watsonx SDK client, Azure headers, etc.)
    // that would corrupt a later request to the FIRST provider again.
    await drain(bedrockModel, '<authenticated>');
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    const bedrockCall2 = calls[4];
    expect(bedrockCall2.url).toContain(
      'bedrock-runtime.us-east-1.amazonaws.com',
    );
    expect(header(bedrockCall2.headers, 'authorization')).toMatch(
      /^AWS4-HMAC-SHA256 /,
    );
    expect(header(bedrockCall2.headers, 'api-key')).toBeUndefined();
    expect(header(bedrockCall2.headers, 'opc-compartment-id')).toBeUndefined();
  });

  it('MODEL_SWITCH: switching AWS_REGION between two Bedrock requests is honored on the very next request (no stale cached region)', async () => {
    const [bedrockModel] = getCatalogModels('amazon-bedrock');

    await drain(bedrockModel, '<authenticated>');
    expect(calls[0].url).toContain('bedrock-runtime.us-east-1.amazonaws.com');

    process.env['AWS_REGION'] = 'eu-west-1';
    await drain(bedrockModel, '<authenticated>');
    expect(calls[1].url).toContain('bedrock-runtime.eu-west-1.amazonaws.com');
    expect(calls[1].url).not.toContain('us-east-1');
  });

  it('CONFIG_SWITCH: PLUMB-saved Azure resourceName changing between two requests is honored immediately (no restart, no stale cache)', async () => {
    const [azureModel] = getCatalogModels('azure');

    await drain(azureModel, 'k');
    expect(calls[0].url).toContain('plumb-test-resource.openai.azure.com');

    setProviderConfigResolver((providerId) =>
      providerId === 'azure'
        ? { resourceName: 'second-resource' }
        : ({} as Record<string, string>),
    );
    await drain(azureModel, 'k');
    expect(calls[1].url).toContain('second-resource.openai.azure.com');
    expect(calls[1].url).not.toContain('plumb-test-resource');
  });
});

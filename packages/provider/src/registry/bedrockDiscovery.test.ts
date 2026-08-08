/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * BedrockDiscovery: real ListFoundationModels control-plane API discovery,
 * reusing the existing AWS credential chain and SigV4 signer -- never a
 * second credential-resolution path, never hand-rolled signing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockResolveAwsCredentials = vi.fn();
const mockSignRequest = vi.fn();

vi.mock('../omp-ai/providers/aws-credentials.js', () => ({
  resolveAwsCredentials: (...args: unknown[]) =>
    mockResolveAwsCredentials(...args),
}));

vi.mock('../omp-ai/providers/aws-sigv4.js', () => ({
  signRequest: (...args: unknown[]) => mockSignRequest(...args),
}));

async function importFresh() {
  vi.resetModules();
  return import('./model-discovery.js');
}

describe('BedrockDiscovery', () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    delete process.env['AWS_REGION'];
    delete process.env['AWS_DEFAULT_REGION'];
  });

  it('resolves real AWS credentials via the existing credential chain, never a second resolution path', async () => {
    process.env['AWS_REGION'] = 'us-west-2';
    mockResolveAwsCredentials.mockResolvedValue({
      accessKeyId: 'AKIA...',
      secretAccessKey: 'secret',
    });
    mockSignRequest.mockResolvedValue({
      host: 'bedrock.us-west-2.amazonaws.com',
      'x-amz-date': '20260101T000000Z',
      'x-amz-content-sha256': 'e3b0...',
      authorization: 'AWS4-HMAC-SHA256 Credential=...',
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ modelSummaries: [] }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const mod = await importFresh();
    await mod.discoverProviderModels('amazon-bedrock', {
      providerId: 'amazon-bedrock',
    });

    expect(mockResolveAwsCredentials).toHaveBeenCalledWith({
      region: 'us-west-2',
    });
  });

  it('signs the real ListFoundationModels request via the existing SigV4 signer, never a hand-rolled signature', async () => {
    process.env['AWS_REGION'] = 'eu-central-1';
    mockResolveAwsCredentials.mockResolvedValue({
      accessKeyId: 'AKIA...',
      secretAccessKey: 'secret',
    });
    mockSignRequest.mockResolvedValue({
      host: 'bedrock.eu-central-1.amazonaws.com',
      'x-amz-date': '20260101T000000Z',
      'x-amz-content-sha256': 'e3b0...',
      authorization: 'AWS4-HMAC-SHA256 Credential=...',
    });
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ modelSummaries: [] }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const mod = await importFresh();
    await mod.discoverProviderModels('amazon-bedrock', {
      providerId: 'amazon-bedrock',
    });

    expect(mockSignRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        host: 'bedrock.eu-central-1.amazonaws.com',
        path: '/foundation-models',
        service: 'bedrock',
        region: 'eu-central-1',
      }),
    );
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://bedrock.eu-central-1.amazonaws.com/foundation-models?byOutputModality=TEXT',
    );
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('AWS4-HMAC-SHA256 Credential=...');
  });

  it('maps real modelSummaries into DiscoveredModel[] tagged with the bedrock-converse-stream dialect', async () => {
    mockResolveAwsCredentials.mockResolvedValue({
      accessKeyId: 'AKIA...',
      secretAccessKey: 'secret',
    });
    mockSignRequest.mockResolvedValue({
      host: 'bedrock.us-east-1.amazonaws.com',
      'x-amz-date': 'x',
      'x-amz-content-sha256': 'x',
      authorization: 'x',
    });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          modelSummaries: [
            {
              modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
              modelName: 'Claude Sonnet 4.5',
              responseStreamingSupported: true,
              modelLifecycle: { status: 'ACTIVE' },
            },
            {
              modelId: 'amazon.titan-text-legacy-v1',
              modelName: 'Titan Text (EOL)',
              modelLifecycle: { status: 'EOL' },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const mod = await importFresh();
    const result = await mod.discoverProviderModels('amazon-bedrock', {
      providerId: 'amazon-bedrock',
    });

    expect(result).toEqual([
      {
        id: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
        name: 'Claude Sonnet 4.5',
        api: 'bedrock-converse-stream',
      },
    ]);
  });

  it('returns [] on credential resolution failure -- never throws out of the discovery boundary', async () => {
    mockResolveAwsCredentials.mockRejectedValue(new Error('no AWS creds'));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const mod = await importFresh();
    const result = await mod.discoverProviderModels('amazon-bedrock', {
      providerId: 'amazon-bedrock',
    });

    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns [] on a non-ok HTTP response rather than throwing', async () => {
    mockResolveAwsCredentials.mockResolvedValue({
      accessKeyId: 'AKIA...',
      secretAccessKey: 'secret',
    });
    mockSignRequest.mockResolvedValue({
      host: 'bedrock.us-east-1.amazonaws.com',
      'x-amz-date': 'x',
      'x-amz-content-sha256': 'x',
      authorization: 'x',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })),
    );

    const mod = await importFresh();
    const result = await mod.discoverProviderModels('amazon-bedrock', {
      providerId: 'amazon-bedrock',
    });

    expect(result).toEqual([]);
  });
});

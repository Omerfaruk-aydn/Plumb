/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production-shaped regression: selecting provider = 'oci-genai' must
 * reach OCI's real, officially-documented OpenAI-wire-compatible endpoint
 * (https://inference.generativeai.{region}.oci.oraclecloud.com/openai/v1)
 * through the real dispatch chain (catalog/model-catalog.ts ->
 * transports/streaming.ts's plumbModelStream -> the shared
 * 'openai-completions' transport), carrying the real, required
 * opc-compartment-id header and Bearer credential -- never a generic
 * openai.com request and never a dropped compartment header.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { plumbModelStream } from './streaming.js';

describe('oci-genai routing (production-shaped, no mocking of streaming.ts/model-catalog.ts)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env['OCI_REGION'] = 'us-chicago-1';
    process.env['OCI_COMPARTMENT_ID'] =
      'ocid1.compartment.oc1..real-compartment';
    fetchSpy = vi.fn().mockResolvedValue(
      new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it('sends the request to the real regional OCI endpoint with the required opc-compartment-id header and a Bearer credential', async () => {
    const [model] = getCatalogModels('oci-genai');
    expect(model).toBeDefined();
    expect(model!.api).toBe('openai-completions');

    const stream = plumbModelStream({
      model: model!,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'real-oci-genai-key',
    });
    for await (const _e of stream) {
      // drain
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/openai/v1/chat/completions',
    );
    const headers = init.headers as Record<string, string>;
    expect(headers['opc-compartment-id']).toBe(
      'ocid1.compartment.oc1..real-compartment',
    );
    expect(headers['Authorization']).toBe('Bearer real-oci-genai-key');
  });

  it('a request without OCI_COMPARTMENT_ID configured omits the header rather than sending a stale/empty one', async () => {
    delete process.env['OCI_COMPARTMENT_ID'];
    const [model] = getCatalogModels('oci-genai');
    expect(model!.headers).toBeUndefined();

    const stream = plumbModelStream({
      model: model!,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
    });
    for await (const _e of stream) {
      // drain
    }

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['opc-compartment-id']).toBeUndefined();
  });

  it('sends the required OpenAI-Project header from OCI_GENAI_PROJECT_ID -- Oracle docs: "OCI OpenAI-compatible API calls require a project"', async () => {
    process.env['OCI_GENAI_PROJECT_ID'] =
      'ocid1.generativeaiproject.oc1.us-chicago-1.real';
    const [model] = getCatalogModels('oci-genai');

    const stream = plumbModelStream({
      model: model!,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'real-oci-genai-key',
    });
    for await (const _e of stream) {
      // drain
    }

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['OpenAI-Project']).toBe(
      'ocid1.generativeaiproject.oc1.us-chicago-1.real',
    );
  });
});

/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production-shaped regression: selecting provider = 'amazon-bedrock' must
 * reach the real, SigV4-signed AWS Bedrock Converse Stream transport
 * (catalog/model-catalog.ts -> transports/streaming.ts's plumbModelStream ->
 * the registered 'bedrock-converse-stream' transport), and must NEVER fall
 * through to the generic OpenAI-compatible transport (which would send a
 * plain `Authorization: Bearer` request to `{baseUrl}/chat/completions` --
 * AWS rejects that outright, and no valid signature would ever be present).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { plumbModelStream } from './streaming.js';
import { setProviderConfigResolver } from '../config/providerConfigResolver.js';
import type { PlumbStreamEvent } from '../types.js';

function encodeEventStreamMessage(
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): Uint8Array {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const headerParts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const nameBytes = new TextEncoder().encode(name);
    const valueBytes = new TextEncoder().encode(value);
    const buf = new Uint8Array(
      1 + nameBytes.length + 1 + 2 + valueBytes.length,
    );
    let o = 0;
    buf[o++] = nameBytes.length;
    buf.set(nameBytes, o);
    o += nameBytes.length;
    buf[o++] = 7; // string value type
    buf[o++] = (valueBytes.length >> 8) & 0xff;
    buf[o++] = valueBytes.length & 0xff;
    buf.set(valueBytes, o);
    headerParts.push(buf);
  }
  const headerBytes = new Uint8Array(
    headerParts.reduce((n, p) => n + p.length, 0),
  );
  let ho = 0;
  for (const p of headerParts) {
    headerBytes.set(p, ho);
    ho += p.length;
  }

  const totalLength = 4 + 4 + 4 + headerBytes.length + payloadBytes.length + 4;
  const out = new Uint8Array(totalLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headerBytes.length, false);
  // Prelude CRC32 (bytes [0,8)) — computed with the same crc32 used by the
  // real decoder (Bun.hash.crc32, shimmed onto globalThis by the test's
  // Bun-global install below).
  const crc32 = (bytes: Uint8Array): number =>
    (
      globalThis as unknown as {
        Bun: { hash: { crc32: (b: Uint8Array) => number } };
      }
    ).Bun.hash.crc32(bytes) >>> 0;
  view.setUint32(8, crc32(out.subarray(0, 8)), false);
  out.set(headerBytes, 12);
  out.set(payloadBytes, 12 + headerBytes.length);
  view.setUint32(
    12 + headerBytes.length + payloadBytes.length,
    crc32(out.subarray(0, totalLength - 4)),
    false,
  );
  return out;
}

function eventStreamBody(
  frames: Array<[Record<string, string>, Record<string, unknown>]>,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const [headers, payload] of frames) {
        controller.enqueue(encodeEventStreamMessage(headers, payload));
      }
      controller.close();
    },
  });
}

describe('amazon-bedrock routing (production-shaped, no mocking of streaming.ts/model-catalog.ts)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    const { installBunGlobal } = await import('../omp-shims/bun-runtime.js');
    installBunGlobal();
    process.env['AWS_ACCESS_KEY_ID'] = 'AKIATESTTESTTESTTEST';
    process.env['AWS_SECRET_ACCESS_KEY'] =
      'test-secret-access-key-value-00000000';
    process.env['AWS_REGION'] = 'us-east-1';
    delete process.env['AWS_BEARER_TOKEN_BEDROCK'];
    delete process.env['AWS_PROFILE'];
    setProviderConfigResolver(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it('signs the request with real AWS SigV4 and reaches the real regional Bedrock Converse Stream endpoint -- never the generic OpenAI-compatible transport', async () => {
    const [model] = getCatalogModels('amazon-bedrock');
    expect(model).toBeDefined();
    expect(model!.api).toBe('bedrock-converse-stream');

    fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        eventStreamBody([
          [
            { ':message-type': 'event', ':event-type': 'messageStart' },
            { role: 'assistant' },
          ],
          [
            { ':message-type': 'event', ':event-type': 'contentBlockDelta' },
            { contentBlockIndex: 0, delta: { text: 'hi' } },
          ],
          [
            { ':message-type': 'event', ':event-type': 'messageStop' },
            { stopReason: 'end_turn' },
          ],
        ]),
        { status: 200 },
      ),
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

    // Real Bedrock Converse Stream endpoint shape -- never
    // `{baseUrl}/chat/completions`.
    expect(url).toBe(
      `https://bedrock-runtime.us-east-1.amazonaws.com/model/${encodeURIComponent(model!.id)}/converse-stream`,
    );

    const headers = init.headers as Record<string, string>;
    // Real SigV4 signature -- never a plain OpenAI-style Bearer token.
    expect(headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(headers['authorization']).toContain('bedrock/aws4_request');
    expect(headers['x-amz-date']).toBeDefined();
    expect(headers['x-amz-content-sha256']).toBeDefined();
    expect(headers['Authorization']).toBeUndefined();

    expect(events.some((e) => e.type === 'text' && e.text === 'hi')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('AWS_BEARER_TOKEN_BEDROCK, when set, is sent as a real Bearer token instead of SigV4 signing -- and the sentinel apiKey is never used as the token', async () => {
    process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'real-bedrock-bearer-token';
    const [model] = getCatalogModels('amazon-bedrock');

    fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(eventStreamBody([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const stream = plumbModelStream({
      model: model!,
      messages: [{ role: 'user', content: 'hi' }],
      // The sentinel PLUMB's generic credential plumbing fills in for
      // env-only providers -- must never leak into the Authorization header.
      apiKey: '<authenticated>',
    });
    for await (const _e of stream) {
      // drain
    }

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer real-bedrock-bearer-token');
    expect(headers['authorization']).toBeUndefined();
  });

  it('a Bedrock HTTP 403 invalidates the cached AWS credential (rotated-key recovery) rather than silently reusing it', async () => {
    const [model] = getCatalogModels('amazon-bedrock');
    fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('Forbidden', { status: 403 }));
    vi.stubGlobal('fetch', fetchSpy);

    const events: PlumbStreamEvent[] = [];
    const stream = plumbModelStream({
      model: model!,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '<authenticated>',
    });
    for await (const e of stream) events.push(e);

    expect(
      events.some(
        (e) => e.type === 'error' && e.error?.code === 'AUTH_REQUIRED',
      ),
    ).toBe(true);
  });
});

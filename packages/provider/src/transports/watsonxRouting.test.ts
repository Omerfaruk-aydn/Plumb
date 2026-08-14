/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { plumbModelStream } from './streaming.js';
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

function makeStream(chunks: unknown[]) {
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}

async function drain(
  gen: AsyncGenerator<PlumbStreamEvent>,
): Promise<PlumbStreamEvent[]> {
  const events: PlumbStreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('watsonx routing (production-shaped, no mocking of streaming.ts/model-catalog.ts)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockTextChatStream.mockReset();
    process.env['WATSONX_PROJECT_ID'] = 'proj-1';
    fetchSpy = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'TEST FAILURE: a real HTTP fetch was attempted for a watsonx request -- ' +
            'it must be routed through the official SDK, never a direct HTTP call.',
        ),
      );
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['WATSONX_PROJECT_ID'];
  });

  it('reaches the real watsonx SDK transport and never calls fetch', async () => {
    mockTextChatStream.mockResolvedValue(
      makeStream([{ data: { choices: [{ delta: { content: 'hello' } }] } }]),
    );

    const [model] = getCatalogModels('watsonx');
    expect(model).toBeDefined();
    expect(model!.api).toBe('watsonx-chat');

    const events = await drain(
      plumbModelStream({
        model: model!,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'ibm-key',
      }),
    );

    expect(mockTextChatStream).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'text' && e.text === 'hello')).toBe(
      true,
    );
  });

  it('control case: an openai model of the same request shape DOES go through fetch, proving this test can actually detect a misroute', async () => {
    const [model] = getCatalogModels('openai');
    expect(model).toBeDefined();
    expect(model!.api).not.toBe('watsonx-chat');

    fetchSpy.mockResolvedValue(
      new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );

    await drain(
      plumbModelStream({
        model: model!,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'test-api-key',
      }),
    );

    expect(fetchSpy).toHaveBeenCalled();
    expect(mockTextChatStream).not.toHaveBeenCalled();
  });
});

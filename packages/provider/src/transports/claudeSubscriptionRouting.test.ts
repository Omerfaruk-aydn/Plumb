/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production-shaped regression: selecting provider = 'claude-subscription'
 * must reach the real official Agent SDK (@anthropic-ai/claude-agent-sdk)
 * through the real dispatch chain (catalog/model-catalog.ts ->
 * transports/streaming.ts's plumbModelStream -> registered
 * 'claude-agent-sdk' transport), and must NEVER fall through to the
 * Anthropic Messages API (HTTP fetch to api.anthropic.com), the raw
 * OMP Claude OAuth flow, or any other provider's transport.
 *
 * This exercises the REAL production modules end-to-end (no mocking of
 * streaming.ts, model-catalog.ts, or the transport registry itself) —
 * only the true network/SDK boundary is mocked: global fetch (to prove
 * no HTTP request ever leaves the process for this provider) and the
 * dynamically-imported Agent SDK package (to avoid a real subprocess).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCatalogModels } from '../catalog/model-catalog.js';
import { plumbModelStream } from './streaming.js';
import type { PlumbStreamEvent } from '../types.js';

const mockQuery = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

function makeSdkQuery(messages: unknown[]) {
  const query = (async function* () {
    for (const m of messages) yield m;
  })() as AsyncGenerator<unknown> & { close?: () => void };
  query.close = vi.fn();
  return query;
}

async function drain(
  gen: AsyncGenerator<PlumbStreamEvent>,
): Promise<PlumbStreamEvent[]> {
  const events: PlumbStreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('claude-subscription routing (production-shaped, no mocking of streaming.ts/model-catalog.ts)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockQuery.mockReset();
    fetchSpy = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'TEST FAILURE: a real HTTP fetch was attempted for a claude-subscription request — ' +
            'it must be routed through the Agent SDK, never a direct HTTP call.',
        ),
      );
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reaches the real Agent SDK transport and never calls fetch', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([
        { type: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        { type: 'result', usage: { input_tokens: 5, output_tokens: 2 } },
      ]),
    );

    const [model] = getCatalogModels('claude-subscription');
    expect(model).toBeDefined();
    expect(model!.api).toBe('claude-agent-sdk');

    const events = await drain(
      plumbModelStream({
        model: model!,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: '',
      }),
    );

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'text' && e.text === 'hello')).toBe(
      true,
    );
  });

  it('control case: an anthropic-api model of the same request shape DOES go through fetch, proving this test can actually detect a misroute', async () => {
    const [model] = getCatalogModels('anthropic-api');
    expect(model).toBeDefined();
    expect(model!.api).toBe('anthropic-messages');

    fetchSpy.mockResolvedValue(
      new Response('data: {"type":"message_stop"}\n\n', {
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
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('passes the real selected claude-subscription model id to the SDK, not a hardcoded/wrong id', async () => {
    mockQuery.mockReturnValue(makeSdkQuery([]));
    const models = getCatalogModels('claude-subscription');
    const target = models.find((m) => m.id !== models[0]!.id) ?? models[0]!;

    await drain(
      plumbModelStream({
        model: target,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: '',
      }),
    );

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [callArgs] = mockQuery.mock.calls[0] as [
      { options?: { model?: string } },
    ];
    expect(callArgs.options?.model).toBe(target.id);
  });

  it('surfaces an explicit AGENT_SDK_UNAVAILABLE error and never silently falls back to a raw HTTP request when the SDK throws on query() construction', async () => {
    // The old raw Claude Code OAuth flow (provider id 'anthropic') is
    // permanently blocked (BLOCKED_UPSTREAM_POLICY, catalog/providers.ts).
    // This proves the failure mode when the Agent SDK itself is broken:
    // an explicit, typed error event — never a silent fetch() fallback to
    // any HTTP-based transport (which is the only way a "legacy OAuth"
    // style request could leave the process for this provider).
    mockQuery.mockImplementation(() => {
      throw new Error('spawn ENOENT');
    });

    const [model] = getCatalogModels('claude-subscription');
    const events = await drain(
      plumbModelStream({
        model: model!,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: '',
      }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('error');
    expect((events[0] as { error: { code: string } }).error.code).toBe(
      'AGENT_SDK_UNAVAILABLE',
    );
  });
});

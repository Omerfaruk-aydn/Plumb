/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Transport/stream activation contract: OMP EventStream is the active
 * stream-normalization authority and is importable by the PLUMB facade.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createNormalizationStream, plumbModelStream } from './streaming.js';
import { EventStream as OmpEventStream } from '../omp-ai/utils/event-stream.js';
import type { PlumbModel, PlumbStreamEvent } from '../types.js';

describe('transport/stream activation', () => {
  it('creates an OMP-backed PlumbEventStream', () => {
    const stream = createNormalizationStream();
    expect(stream).toBeInstanceOf(OmpEventStream);

    // Push a done event through the OMP pipeline
    stream.push({ type: 'done' });

    // The stream should be consumed after a terminal event
    expect(stream.done).toBe(true);
  });

  it('OMP EventStream is directly importable by the facade', () => {
    const stream = new OmpEventStream<{ type: string }, void>(
      (e) => e.type === 'end',
      () => undefined as void,
    );
    expect(stream).toBeInstanceOf(OmpEventStream);
    expect(stream.done).toBe(false);
  });
});

describe('plumbModelStream — missing-credential guard', () => {
  // This is the transport PlumbContentGenerator actually calls for real
  // chat streaming (see packages/core/src/core/plumbContentGenerator.ts).
  // A missing/empty apiKey must fail with a classified error event instead
  // of silently building `Authorization: Bearer ` (no token), which is what
  // GitHub rejects as "Authorization header is badly formatted".
  const copilotModel: PlumbModel = {
    id: 'gpt-5.5',
    provider: 'github-copilot',
    api: 'openai-completions',
    contextWindow: 128_000,
    maxTokens: 8_192,
    reasoning: false,
    input: 'text',
  };

  it('yields a MISSING_CREDENTIAL error instead of sending an empty Bearer header', async () => {
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: copilotModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
    })) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'MISSING_CREDENTIAL' },
    });
  });

  it('never reaches fetch for an empty credential', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCalled = true;
      return originalFetch(...args);
    }) as typeof fetch;
    try {
      for await (const _event of plumbModelStream({
        model: copilotModel,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: '',
      })) {
        // drain
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalled).toBe(false);
  });
});

describe('plumbModelStream — GitHub Copilot anthropic-messages auth header', () => {
  // Real-world regression: claude-sonnet-5 under github-copilot resolves to
  // api: 'anthropic-messages' in the bundled catalog, routing through
  // anthropicMessagesStream (not openAICompatibleStream). That function
  // defaulted to `x-api-key`, which GitHub's Copilot proxy rejects with
  // "missing required Authorization header" even when a real credential is
  // present — a different, real-transport-only bug from the empty-credential
  // guard above.
  const copilotClaudeModel: PlumbModel = {
    id: 'claude-sonnet-5',
    provider: 'github-copilot',
    api: 'anthropic-messages',
    baseUrl: 'https://api.githubcopilot.com',
    contextWindow: 200_000,
    maxTokens: 8_192,
    reasoning: false,
    input: 'text',
  };

  const nativeAnthropicModel: PlumbModel = {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    contextWindow: 200_000,
    maxTokens: 8_192,
    reasoning: false,
    input: 'text',
  };

  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends Authorization: Bearer (not x-api-key) for github-copilot', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(null, { status: 200, headers: {} });
    }) as typeof fetch;

    for await (const _event of plumbModelStream({
      model: copilotClaudeModel,
      messages: [{ role: 'user', content: 'merhaba' }],
      apiKey: 'gho_real_copilot_token',
    })) {
      // drain
    }

    expect(capturedHeaders?.['Authorization']).toBe(
      'Bearer gho_real_copilot_token',
    );
    expect(capturedHeaders?.['x-api-key']).toBeUndefined();
  });

  it('still uses x-api-key for native (non-Copilot) Anthropic requests', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(null, { status: 200, headers: {} });
    }) as typeof fetch;

    for await (const _event of plumbModelStream({
      model: nativeAnthropicModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-ant-real-key',
    })) {
      // drain
    }

    expect(capturedHeaders?.['x-api-key']).toBe('sk-ant-real-key');
    expect(capturedHeaders?.['Authorization']).toBeUndefined();
  });

  it('yields MISSING_CREDENTIAL for an empty credential on the anthropic-messages path too', async () => {
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: copilotClaudeModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
    })) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'MISSING_CREDENTIAL' },
    });
  });
});

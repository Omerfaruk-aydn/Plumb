/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PlumbModel, PlumbStreamEvent } from '../types.js';

const mockQuery = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

async function importFresh() {
  vi.resetModules();
  const mod = await import('./claudeSubscription.js');
  mod.__resetClaudeAgentSdkCacheForTests();
  return mod;
}

const subscriptionModel: PlumbModel = {
  id: 'claude-sonnet-5',
  provider: 'claude-subscription',
  api: 'claude-agent-sdk',
  contextWindow: 200_000,
  maxTokens: 64_000,
  reasoning: true,
  input: 'text',
};

function makeSdkQuery(messages: unknown[], accountInfo?: unknown) {
  const query = (async function* () {
    for (const m of messages) yield m;
  })() as AsyncGenerator<unknown> & {
    accountInfo?: () => Promise<unknown>;
    close?: () => void;
  };
  query.accountInfo = accountInfo
    ? async () => accountInfo
    : async () => undefined;
  query.close = vi.fn();
  return query;
}

describe('getClaudeSubscriptionStatus', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('reports AGENT_SDK_UNAVAILABLE when the optional dependency import fails', async () => {
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => {
      throw new Error('Cannot find module');
    });
    const mod = await importFresh();
    const result = await mod.getClaudeSubscriptionStatus();
    expect(result.status).toBe('AGENT_SDK_UNAVAILABLE');
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: (...args: unknown[]) => mockQuery(...args),
    }));
  });

  it('reports NOT_LOGGED_IN when accountInfo() resolves with no account', async () => {
    mockQuery.mockReturnValue(makeSdkQuery([], undefined));
    const mod = await importFresh();
    const result = await mod.getClaudeSubscriptionStatus();
    expect(result.status).toBe('NOT_LOGGED_IN');
  });

  it('reports CONNECTED_SUBSCRIPTION with safe account metadata when a subscription is attached', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([], {
        email: 'user@example.com',
        organization: 'Acme',
        subscriptionType: 'max',
      }),
    );
    const mod = await importFresh();
    const result = await mod.getClaudeSubscriptionStatus();
    expect(result.status).toBe('CONNECTED_SUBSCRIPTION');
    expect(result.account).toEqual({
      email: 'user@example.com',
      organization: 'Acme',
      subscriptionType: 'max',
    });
  });

  it('never includes an access token, refresh token, or Authorization header in the result', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([], {
        email: 'user@example.com',
        subscriptionType: 'pro',
        // Simulate the SDK leaking something it shouldn't — the status
        // mapper must not forward unknown/secret-shaped fields.
        access_token: 'sk-ant-oat01-should-never-appear',
      }),
    );
    const mod = await importFresh();
    const result = await mod.getClaudeSubscriptionStatus();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('sk-ant-oat01-should-never-appear');
  });

  it('reports PLAN_UNSUPPORTED when authenticated but no subscription plan is attached', async () => {
    mockQuery.mockReturnValue(makeSdkQuery([], { email: 'user@example.com' }));
    const mod = await importFresh();
    const result = await mod.getClaudeSubscriptionStatus();
    expect(result.status).toBe('PLAN_UNSUPPORTED');
  });

  it('classifies an auth-shaped error message as NOT_LOGGED_IN', async () => {
    mockQuery.mockImplementation(() => {
      throw new Error('401 unauthenticated: please login');
    });
    const mod = await importFresh();
    const result = await mod.getClaudeSubscriptionStatus();
    expect(result.status).toBe('NOT_LOGGED_IN');
  });

  it('probes with tools disabled and zero turns (never sends a real prompt)', async () => {
    mockQuery.mockReturnValue(makeSdkQuery([], { subscriptionType: 'pro' }));
    const mod = await importFresh();
    await mod.getClaudeSubscriptionStatus();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '',
        options: expect.objectContaining({ tools: [], maxTurns: 0 }),
      }),
    );
  });
});

describe('streamClaudeSubscription', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('yields AGENT_SDK_UNAVAILABLE when the SDK is not installed', async () => {
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => {
      throw new Error('Cannot find module');
    });
    const mod = await importFresh();
    const events: PlumbStreamEvent[] = [];
    for await (const event of mod.streamClaudeSubscription({
      model: subscriptionModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
    })) {
      events.push(event);
    }
    expect(events).toEqual([
      {
        type: 'error',
        error: {
          code: 'AGENT_SDK_UNAVAILABLE',
          message: expect.stringContaining('claude-agent-sdk'),
        },
      },
    ]);
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: (...args: unknown[]) => mockQuery(...args),
    }));
  });

  it('always disables built-in tools (tools: [])', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([{ type: 'result', subtype: 'success' }]),
    );
    const mod = await importFresh();
    for await (const _e of mod.streamClaudeSubscription({
      model: subscriptionModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
    })) {
      // drain
    }
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ tools: [] }),
      }),
    );
  });

  it('normalizes assistant text/thinking blocks and usage into PlumbStreamEvent', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([
        {
          type: 'assistant',
          content: [
            { type: 'thinking', thinking: 'considering...' },
            { type: 'text', text: 'Hello there' },
          ],
        },
        {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      ]),
    );
    const mod = await importFresh();
    const events: PlumbStreamEvent[] = [];
    for await (const event of mod.streamClaudeSubscription({
      model: subscriptionModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
    })) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: 'thinking', thinkingText: 'considering...' },
      { type: 'text', text: 'Hello there' },
      {
        type: 'usage',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadInputTokens: undefined,
          cacheCreationInputTokens: undefined,
          totalTokens: 15,
        },
      },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('drops any tool_use block instead of executing it (tools are disabled; this is the safe failure mode)', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([
        {
          type: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'Bash',
              input: { command: 'ls' },
            },
            { type: 'text', text: 'ok' },
          ],
        },
        { type: 'result', subtype: 'success' },
      ]),
    );
    const mod = await importFresh();
    const events: PlumbStreamEvent[] = [];
    for await (const event of mod.streamClaudeSubscription({
      model: subscriptionModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
    })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'tool_call')).toBe(false);
    expect(events).toContainEqual({ type: 'text', text: 'ok' });
  });

  it('classifies a documented SDKAssistantMessageError to a canonical code', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([
        { type: 'assistant', content: [], error: 'authentication_failed' },
      ]),
    );
    const mod = await importFresh();
    const events: PlumbStreamEvent[] = [];
    for await (const event of mod.streamClaudeSubscription({
      model: subscriptionModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
    })) {
      events.push(event);
    }
    expect(events).toEqual([
      {
        type: 'error',
        error: { code: 'AUTH_REQUIRED', message: 'authentication_failed' },
      },
    ]);
  });

  it('respects cancellation via AbortSignal', async () => {
    const controller = new AbortController();
    mockQuery.mockReturnValue(
      makeSdkQuery([
        { type: 'assistant', content: [{ type: 'text', text: 'partial' }] },
      ]),
    );
    const mod = await importFresh();
    controller.abort();
    const events: PlumbStreamEvent[] = [];
    for await (const event of mod.streamClaudeSubscription({
      model: subscriptionModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
      signal: controller.signal,
    })) {
      events.push(event);
    }
    expect(events).toEqual([{ type: 'done', finishReason: 'cancelled' }]);
  });

  it('never forwards apiKey/credential material into the SDK call options', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([{ type: 'result', subtype: 'success' }]),
    );
    const mod = await importFresh();
    for await (const _e of mod.streamClaudeSubscription({
      model: subscriptionModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'should-never-be-forwarded',
    })) {
      // drain
    }
    const callArgs = JSON.stringify(mockQuery.mock.calls[0]);
    expect(callArgs).not.toContain('should-never-be-forwarded');
  });
});

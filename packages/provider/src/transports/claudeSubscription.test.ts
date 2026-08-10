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
    // Pinned Agent SDK 0.1.77 shape: SDKAssistantMessage nests the API
    // assistant message (with content blocks) under `message`.
    mockQuery.mockReturnValue(
      makeSdkQuery([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'thinking', thinking: 'considering...' },
              { type: 'text', text: 'Hello there' },
            ],
          },
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

  it('reads assistant text from the pinned Agent SDK 0.1.77 nested shape (message.message.content) — live-acceptance regression', async () => {
    // REGRESSION (live-observed): an earlier revision read top-level
    // `message.content`, which the real SDK never populates — every real
    // assistant reply was silently dropped, so a genuinely successful stream
    // completed with usage+done but no text and the acceptance harness
    // honestly reported LIVE_TEST_FAILED. This mock is shaped EXACTLY like
    // the pinned SDK's SDKAssistantMessage (see sdk.d.ts): content blocks
    // live under the nested API assistant message, alongside the extra
    // envelope fields the real SDK attaches (uuid/session_id/
    // parent_tool_use_id), proving the transport reads the real shape.
    mockQuery.mockReturnValue(
      makeSdkQuery([
        {
          type: 'assistant',
          uuid: '00000000-0000-4000-8000-000000000001',
          session_id: 'session-1',
          parent_tool_use_id: null,
          message: {
            id: 'msg_1',
            role: 'assistant',
            model: 'claude-sonnet-5',
            content: [{ type: 'text', text: 'OK' }],
            stop_reason: 'end_turn',
          },
        },
        {
          type: 'result',
          subtype: 'success',
          result: 'OK',
          usage: { input_tokens: 3, output_tokens: 1 },
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
    expect(events).toContainEqual({ type: 'text', text: 'OK' });
    expect(events).toContainEqual({ type: 'done', finishReason: 'stop' });
  });

  it('still tolerates a legacy flat top-level content array (older/partial SDK builds)', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([
        { type: 'assistant', content: [{ type: 'text', text: 'legacy' }] },
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
    expect(events).toContainEqual({ type: 'text', text: 'legacy' });
  });

  it('drops any tool_use block instead of executing it (tools are disabled; this is the safe failure mode)', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([
        {
          type: 'assistant',
          message: {
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
        {
          type: 'assistant',
          message: { content: [] },
          error: 'authentication_failed',
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
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'partial' }] },
        },
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

  describe('multi-turn conversation (stateless-per-call transcript serialization)', () => {
    it('carries the full prior conversation into turn 2 and turn 3 (each query() is independent, per the documented v1 scope)', async () => {
      const mod = await importFresh();

      // Turn 1
      mockQuery.mockReturnValueOnce(
        makeSdkQuery([
          {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Hi! How can I help?' }] },
          },
          { type: 'result', subtype: 'success' },
        ]),
      );
      for await (const _e of mod.streamClaudeSubscription({
        model: subscriptionModel,
        messages: [{ role: 'user', content: 'What is 2+2?' }],
        apiKey: '',
      })) {
        // drain
      }
      const turn1Prompt = mockQuery.mock.calls[0]![0].prompt as string;
      expect(turn1Prompt).toContain('What is 2+2?');

      // Turn 2 — caller (plumbContentGenerator) re-sends the full history,
      // including the assistant's turn-1 reply, per PlumbStreamOptions'
      // stateless-per-call contract shared by every transport in this file.
      mockQuery.mockReturnValueOnce(
        makeSdkQuery([
          {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'It is 4.' }] },
          },
          { type: 'result', subtype: 'success' },
        ]),
      );
      for await (const _e of mod.streamClaudeSubscription({
        model: subscriptionModel,
        messages: [
          { role: 'user', content: 'What is 2+2?' },
          { role: 'assistant', content: 'Hi! How can I help?' },
          { role: 'user', content: 'And what is 4+4?' },
        ],
        apiKey: '',
      })) {
        // drain
      }
      const turn2Prompt = mockQuery.mock.calls[1]![0].prompt as string;
      expect(turn2Prompt).toContain('What is 2+2?');
      expect(turn2Prompt).toContain('Hi! How can I help?');
      expect(turn2Prompt).toContain('And what is 4+4?');

      // Turn 3 — full accumulated history again.
      mockQuery.mockReturnValueOnce(
        makeSdkQuery([
          {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'It is 8.' }] },
          },
          { type: 'result', subtype: 'success' },
        ]),
      );
      for await (const _e of mod.streamClaudeSubscription({
        model: subscriptionModel,
        messages: [
          { role: 'user', content: 'What is 2+2?' },
          { role: 'assistant', content: 'Hi! How can I help?' },
          { role: 'user', content: 'And what is 4+4?' },
          { role: 'assistant', content: 'It is 4.' },
          { role: 'user', content: 'And 8+8?' },
        ],
        apiKey: '',
      })) {
        // drain
      }
      expect(mockQuery).toHaveBeenCalledTimes(3);
      const turn3Prompt = mockQuery.mock.calls[2]![0].prompt as string;
      expect(turn3Prompt).toContain('What is 2+2?');
      expect(turn3Prompt).toContain('And what is 4+4?');
      expect(turn3Prompt).toContain('It is 4.');
      expect(turn3Prompt).toContain('And 8+8?');
    });

    it("a new conversation (fresh, single-message history) never carries over a prior call's transcript text", async () => {
      const mod = await importFresh();

      mockQuery.mockReturnValueOnce(
        makeSdkQuery([{ type: 'result', subtype: 'success' }]),
      );
      for await (const _e of mod.streamClaudeSubscription({
        model: subscriptionModel,
        messages: [{ role: 'user', content: 'SECRET_PRIOR_TOPIC' }],
        apiKey: '',
      })) {
        // drain
      }

      mockQuery.mockReturnValueOnce(
        makeSdkQuery([{ type: 'result', subtype: 'success' }]),
      );
      for await (const _e of mod.streamClaudeSubscription({
        model: subscriptionModel,
        messages: [{ role: 'user', content: 'brand new topic' }],
        apiKey: '',
      })) {
        // drain
      }

      const secondPrompt = mockQuery.mock.calls[1]![0].prompt as string;
      expect(secondPrompt).toContain('brand new topic');
      expect(secondPrompt).not.toContain('SECRET_PRIOR_TOPIC');
    });

    it('switching model between turns uses the newly selected model on the next call, not the previous one', async () => {
      const mod = await importFresh();

      mockQuery.mockReturnValueOnce(
        makeSdkQuery([{ type: 'result', subtype: 'success' }]),
      );
      for await (const _e of mod.streamClaudeSubscription({
        model: subscriptionModel,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: '',
      })) {
        // drain
      }
      expect(mockQuery.mock.calls[0]![0].options.model).toBe(
        subscriptionModel.id,
      );

      const otherModel = { ...subscriptionModel, id: 'claude-opus-4-8' };
      mockQuery.mockReturnValueOnce(
        makeSdkQuery([{ type: 'result', subtype: 'success' }]),
      );
      for await (const _e of mod.streamClaudeSubscription({
        model: otherModel,
        messages: [{ role: 'user', content: 'hi again' }],
        apiKey: '',
      })) {
        // drain
      }
      expect(mockQuery.mock.calls[1]![0].options.model).toBe('claude-opus-4-8');
    });
  });
});

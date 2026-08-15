/**
 * Copyright 2026 PLUMB contributors
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

  it('probes with tools disabled and zero turns (never sends a real prompt) but never ships an empty cache_control-unsafe text block', async () => {
    mockQuery.mockReturnValue(makeSdkQuery([], { subscriptionType: 'pro' }));
    const mod = await importFresh();
    await mod.getClaudeSubscriptionStatus();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        // Non-empty placeholder char — see cache_control safety note
        // in getClaudeSubscriptionStatus above. A literal '' is the
        // exact shape Anthropic rejects with HTTP 400.
        prompt: 'p',
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
            message: {
              content: [{ type: 'text', text: 'Hi! How can I help?' }],
            },
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

describe('resolveClaudeCliCommand', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('prefers a claude binary found on PATH over the bundled SDK CLI', async () => {
    const mod = await importFresh();
    const result = await mod.resolveClaudeCliCommand({
      findOnPath: () => '/usr/local/bin/claude',
      resolveBundledCliJs: async () => '/should/not/be/used/cli.js',
    });
    expect(result).toEqual({
      command: '/usr/local/bin/claude',
      args: [],
      source: 'PATH',
    });
  });

  it('falls back to the bundled SDK cli.js run via node when nothing is on PATH', async () => {
    const mod = await importFresh();
    const result = await mod.resolveClaudeCliCommand({
      findOnPath: () => null,
      resolveBundledCliJs: async () =>
        '/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js',
    });
    expect(result).toEqual({
      command: process.execPath,
      args: ['/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js'],
      source: 'BUNDLED_SDK',
    });
  });

  it('returns null when neither PATH nor the bundled SDK expose a CLI', async () => {
    const mod = await importFresh();
    const result = await mod.resolveClaudeCliCommand({
      findOnPath: () => null,
      resolveBundledCliJs: async () => null,
    });
    expect(result).toBeNull();
  });
});

describe('runClaudeSubscriptionReauth', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('reports CLI_NOT_FOUND without spawning anything when no CLI can be resolved', async () => {
    const mod = await importFresh();
    const spawnInherit = vi.fn();
    const result = await mod.runClaudeSubscriptionReauth({
      findOnPath: () => null,
      resolveBundledCliJs: async () => null,
      spawnInherit,
    });
    expect(result.outcome).toBe('CLI_NOT_FOUND');
    expect(spawnInherit).not.toHaveBeenCalled();
  });

  it('spawns "setup-token" against the resolved CLI with inherited stdio and reports COMPLETED on exit code 0', async () => {
    const mod = await importFresh();
    const spawnInherit = vi.fn().mockResolvedValue(0);
    const result = await mod.runClaudeSubscriptionReauth({
      findOnPath: () => '/usr/local/bin/claude',
      spawnInherit,
    });
    expect(spawnInherit).toHaveBeenCalledWith(
      '/usr/local/bin/claude',
      ['setup-token'],
      expect.objectContaining({ shell: expect.any(Boolean) }),
    );
    expect(result).toEqual({ outcome: 'COMPLETED', exitCode: 0 });
  });

  it('reports NONZERO_EXIT (not an error) when the official CLI exits non-zero, e.g. the user cancelled', async () => {
    const mod = await importFresh();
    const spawnInherit = vi.fn().mockResolvedValue(1);
    const result = await mod.runClaudeSubscriptionReauth({
      findOnPath: () => '/usr/local/bin/claude',
      spawnInherit,
    });
    expect(result).toEqual({ outcome: 'NONZERO_EXIT', exitCode: 1 });
  });

  it('reports SPAWN_FAILED when the child process itself cannot be started', async () => {
    const mod = await importFresh();
    const spawnInherit = vi.fn().mockRejectedValue(new Error('ENOENT'));
    const result = await mod.runClaudeSubscriptionReauth({
      findOnPath: () => '/usr/local/bin/claude',
      spawnInherit,
    });
    expect(result.outcome).toBe('SPAWN_FAILED');
    expect(result.detail).toContain('ENOENT');
  });
});

describe('getClaudeSubscriptionModels', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  function makeQueryWithSupportedModels(
    models:
      | Array<{ value: string; displayName?: string; description?: string }>
      | undefined,
  ) {
    const query = (async function* () {
      // no assistant/result messages needed -- getClaudeSubscriptionModels
      // never iterates the query, only calls supportedModels().
    })() as AsyncGenerator<unknown> & {
      supportedModels?: () => Promise<typeof models>;
      close?: () => void;
    };
    query.supportedModels =
      models === undefined ? undefined : async () => models;
    query.close = vi.fn();
    return query;
  }

  it('falls back to the pinned static floor when the SDK is not installed', async () => {
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => {
      throw new Error('Cannot find module');
    });
    const mod = await importFresh();
    const result = await mod.getClaudeSubscriptionModels();
    expect(result.source).toBe('OFFICIAL_STATIC_METADATA');
    expect(result.models).toEqual(mod.CLAUDE_SUBSCRIPTION_MODELS);
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: (...args: unknown[]) => mockQuery(...args),
    }));
  });

  it('falls back to the pinned static floor when the installed SDK build has no supportedModels()', async () => {
    mockQuery.mockReturnValue(makeQueryWithSupportedModels(undefined));
    const mod = await importFresh();
    const result = await mod.getClaudeSubscriptionModels();
    expect(result.source).toBe('OFFICIAL_STATIC_METADATA');
    expect(result.models).toEqual(mod.CLAUDE_SUBSCRIPTION_MODELS);
  });

  it('falls back to the pinned static floor when supportedModels() throws', async () => {
    const query = makeQueryWithSupportedModels([]);
    query.supportedModels = async () => {
      throw new Error('not authenticated');
    };
    mockQuery.mockReturnValue(query);
    const mod = await importFresh();
    const result = await mod.getClaudeSubscriptionModels();
    expect(result.source).toBe('OFFICIAL_STATIC_METADATA');
  });

  it('falls back to the pinned static floor on an empty supportedModels() result', async () => {
    mockQuery.mockReturnValue(makeQueryWithSupportedModels([]));
    const mod = await importFresh();
    const result = await mod.getClaudeSubscriptionModels();
    expect(result.source).toBe('OFFICIAL_STATIC_METADATA');
  });

  it('rejects a placeholder-only result (e.g. "default") instead of trusting it as real account data', async () => {
    mockQuery.mockReturnValue(
      makeQueryWithSupportedModels([
        { value: 'default', displayName: 'Default' },
      ]),
    );
    const mod = await importFresh();
    const result = await mod.getClaudeSubscriptionModels();
    expect(result.source).toBe('OFFICIAL_STATIC_METADATA');
    expect(result.models).toEqual(mod.CLAUDE_SUBSCRIPTION_MODELS);
  });

  it('keeps a "default" entry when it accompanies other real generic aliases (observed live shape: default+opus+haiku), instead of dropping it as a placeholder', async () => {
    mockQuery.mockReturnValue(
      makeQueryWithSupportedModels([
        {
          value: 'default',
          displayName: 'Default (recommended)',
          description: 'Sonnet 4.5 · Best for everyday tasks',
        },
        {
          value: 'opus',
          displayName: 'Opus',
          description: 'Opus 4.5 · Most capable for complex work',
        },
        {
          value: 'haiku',
          displayName: 'Haiku',
          description: 'Haiku 4.5 · Fastest for quick answers',
        },
      ]),
    );
    const mod = await importFresh();
    const result = await mod.getClaudeSubscriptionModels();
    expect(result.source).toBe('ACCOUNT_DYNAMIC');
    expect(result.models.map((m) => m.id).sort()).toEqual(
      ['default', 'haiku', 'opus'].sort(),
    );
    const defaultEntry = result.models.find((m) => m.id === 'default');
    expect(defaultEntry?.source).toBe('ACCOUNT_DYNAMIC');
  });

  it('reports ACCOUNT_DYNAMIC and reuses known numeric metadata when a discovered id matches a pinned entry exactly', async () => {
    mockQuery.mockReturnValue(
      makeQueryWithSupportedModels([
        { value: 'claude-opus-4-8', displayName: 'Claude Opus 4.8' },
        { value: 'claude-sonnet-5', displayName: 'Claude Sonnet 5' },
      ]),
    );
    const mod = await importFresh();
    const result = await mod.getClaudeSubscriptionModels();
    expect(result.source).toBe('ACCOUNT_DYNAMIC');
    expect(result.models).toEqual([
      { ...mod.CLAUDE_SUBSCRIPTION_MODELS[0], source: 'ACCOUNT_DYNAMIC' },
      { ...mod.CLAUDE_SUBSCRIPTION_MODELS[1], source: 'ACCOUNT_DYNAMIC' },
    ]);
  });

  it('includes a genuinely new discovered id (e.g. a generic alias) using conservative, non-fabricated floor metadata rather than dropping it', async () => {
    mockQuery.mockReturnValue(
      makeQueryWithSupportedModels([
        {
          value: 'haiku',
          displayName: 'Haiku',
          description: 'Fast and efficient for everyday coding',
        },
      ]),
    );
    const mod = await importFresh();
    const result = await mod.getClaudeSubscriptionModels();
    expect(result.source).toBe('ACCOUNT_DYNAMIC');
    expect(result.models).toEqual([
      {
        id: 'haiku',
        name: 'Haiku',
        contextWindow: 200_000,
        maxTokens: 32_000,
        reasoning: false,
        source: 'ACCOUNT_DYNAMIC',
        limitsSource: 'GENERIC_FLOOR',
      },
    ]);
  });

  it('never drops the model count below the pinned static floor across any discovery outcome', async () => {
    const mod = await importFresh();
    const floorCount = mod.CLAUDE_SUBSCRIPTION_MODELS.length;

    mockQuery.mockReturnValue(makeQueryWithSupportedModels([]));
    expect(
      (await mod.getClaudeSubscriptionModels()).models.length,
    ).toBeGreaterThanOrEqual(floorCount);

    mockQuery.mockReturnValue(
      makeQueryWithSupportedModels([
        { value: 'opus' },
        { value: 'sonnet' },
        { value: 'haiku' },
      ]),
    );
    expect(
      (await mod.getClaudeSubscriptionModels()).models.length,
    ).toBeGreaterThanOrEqual(floorCount);
  });

  // ─── REGRESSION: empty cache_control 400 ───────────────────────────
  //
  // The first-turn HTTP 400 reported on real interactive Claude
  // Subscription runs was: `cache_control cannot be set for empty
  // text blocks` (Anthropic rejects any request whose last text
  // content block has cache_control AND an empty/whitespace-only
  // text). The Agent SDK auto-attaches cache_control to the last
  // text block of every outbound request, so the literal `prompt:
  // ''` this module used to pass to `sdk.query({...})` produced
  // exactly the rejected shape. The fix is a non-empty, non-
  // whitespace placeholder that survives the SDK's own
  // normalize pass; the regression test asserts the placeholder is
  // always passed to the SDK regardless of which discovery code
  // path runs.
  it('REGRESSION (empty cache_control 400): never passes an empty or whitespace-only prompt to the SDK', async () => {
    const capturedPrompts: string[] = [];
    const query = makeQueryWithSupportedModels([{ value: 'claude-sonnet-5' }]);
    mockQuery.mockImplementation((args: { prompt?: string }) => {
      if (typeof args?.prompt === 'string') capturedPrompts.push(args.prompt);
      return query;
    });
    const mod = await importFresh();
    await mod.getClaudeSubscriptionModels();
    expect(capturedPrompts.length).toBeGreaterThan(0);
    for (const prompt of capturedPrompts) {
      expect(prompt.length).toBeGreaterThan(0);
      // Must not be whitespace-only either: the SDK's own
      // trim/normalize pass can collapse pure whitespace to empty
      // and re-introduce the rejected shape.
      expect(prompt.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('formatTranscriptPrompt (cache_control safety)', () => {
  // REGRESSION: Anthropic's HTTP 400 `cache_control cannot be set
  // for empty text blocks` was triggered in the live chat path by
  // any caller that produced an empty / whitespace-only transcript
  // — a regression here would surface as an instant chat-failure
  // for the first user message. formatTranscriptPrompt is the
  // canonical normalization boundary, so its invariants belong here.
  it('returns a non-empty, non-whitespace prompt even with no systemPrompt and no messages', async () => {
    const mod = await importFresh();
    const prompt = mod.formatTranscriptPrompt({
      model: subscriptionModel,
      messages: [],
      apiKey: 'unused-but-required-by-PlumbStreamOptions',
    });
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt.trim().length).toBeGreaterThan(0);
  });

  it('keeps the user-supplied text verbatim and tags it with [user] role when systemPrompt is absent', async () => {
    const mod = await importFresh();
    const prompt = mod.formatTranscriptPrompt({
      model: subscriptionModel,
      messages: [{ role: 'user', content: 'Analyze this project' }],
      apiKey: 'unused-but-required-by-PlumbStreamOptions',
    });
    expect(prompt).toContain('Analyze this project');
  });

  it('prepends [system] prefix when a systemPrompt is present', async () => {
    const mod = await importFresh();
    const prompt = mod.formatTranscriptPrompt({
      model: subscriptionModel,
      systemPrompt: 'You are a careful assistant.',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'unused-but-required-by-PlumbStreamOptions',
    });
    expect(prompt).toContain('[system]');
    expect(prompt).toContain('You are a careful assistant.');
    expect(prompt).toContain('[user]');
    expect(prompt).toContain('hi');
  });
});

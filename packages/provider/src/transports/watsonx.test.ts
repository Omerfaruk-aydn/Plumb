/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PlumbModel, PlumbStreamEvent } from '../types.js';

const mockTextChatStream = vi.fn();
const mockNewInstance = vi.fn((options: unknown) => ({
  textChatStream: mockTextChatStream,
}));
const mockIamAuthenticatorCtor = vi.fn();

vi.mock('@ibm-cloud/watsonx-ai', () => ({
  WatsonXAI: { newInstance: (options: unknown) => mockNewInstance(options) },
}));

vi.mock('ibm-cloud-sdk-core', () => ({
  IamAuthenticator: class {
    constructor(options: unknown) {
      mockIamAuthenticatorCtor(options);
    }
  },
}));

async function importFresh() {
  vi.resetModules();
  const mod = await import('./watsonx.js');
  mod.__resetWatsonxClientCacheForTests();
  return mod;
}

const watsonxModel: PlumbModel = {
  id: 'ibm/granite-3-3-8b-instruct',
  provider: 'watsonx',
  api: 'watsonx-chat',
  contextWindow: 131072,
  maxTokens: 8192,
  reasoning: false,
  input: 'text',
};

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

describe('streamWatsonx', () => {
  afterEach(() => {
    vi.resetAllMocks();
    delete process.env['WATSONX_PROJECT_ID'];
    delete process.env['WATSONX_SPACE_ID'];
    delete process.env['WATSONX_REGION'];
  });

  it('yields INVALID_REQUEST when neither WATSONX_PROJECT_ID nor WATSONX_SPACE_ID is set', async () => {
    const mod = await importFresh();
    const events = await drain(
      mod.streamWatsonx({
        model: watsonxModel,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'ibm-api-key',
      }),
    );
    expect(events).toEqual([
      {
        type: 'error',
        error: {
          code: 'INVALID_REQUEST',
          message: expect.stringContaining('WATSONX_PROJECT_ID'),
        },
      },
    ]);
    expect(mockTextChatStream).not.toHaveBeenCalled();
  });

  it('yields AUTH_REQUIRED when no API key is supplied', async () => {
    process.env['WATSONX_PROJECT_ID'] = 'proj-1';
    const mod = await importFresh();
    const events = await drain(
      mod.streamWatsonx({
        model: watsonxModel,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: '',
      }),
    );
    expect(events).toEqual([
      {
        type: 'error',
        error: { code: 'AUTH_REQUIRED', message: expect.any(String) },
      },
    ]);
  });

  it('authenticates via IamAuthenticator with the API key -- never sends the raw API key as a model bearer credential', async () => {
    process.env['WATSONX_PROJECT_ID'] = 'proj-1';
    mockTextChatStream.mockResolvedValue(makeStream([]));
    const mod = await importFresh();
    for await (const _e of mod.streamWatsonx({
      model: watsonxModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'super-secret-ibm-key',
    })) {
      // drain
    }

    expect(mockIamAuthenticatorCtor).toHaveBeenCalledWith({
      apikey: 'super-secret-ibm-key',
    });
    // The chat request itself never carries the raw key -- only modelId/
    // messages/projectId/spaceId/generation params.
    const [chatParams] = mockTextChatStream.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(JSON.stringify(chatParams)).not.toContain('super-secret-ibm-key');
  });

  it('routes to the correct regional service URL from WATSONX_REGION (defaults to us-south)', async () => {
    process.env['WATSONX_PROJECT_ID'] = 'proj-1';
    process.env['WATSONX_REGION'] = 'eu-de';
    mockTextChatStream.mockResolvedValue(makeStream([]));
    const mod = await importFresh();
    for await (const _e of mod.streamWatsonx({
      model: watsonxModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
    })) {
      // drain
    }
    const instanceOptions = mockNewInstance.mock.calls[0]?.[0] as {
      serviceUrl: string;
    };
    expect(instanceOptions.serviceUrl).toBe('https://eu-de.ml.cloud.ibm.com');
  });

  it('passes projectId through to the chat request', async () => {
    process.env['WATSONX_PROJECT_ID'] = 'my-real-project';
    mockTextChatStream.mockResolvedValue(makeStream([]));
    const mod = await importFresh();
    for await (const _e of mod.streamWatsonx({
      model: watsonxModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
    })) {
      // drain
    }
    const [chatParams] = mockTextChatStream.mock.calls[0] as [
      { projectId?: string; modelId: string },
    ];
    expect(chatParams.projectId).toBe('my-real-project');
    expect(chatParams.modelId).toBe('ibm/granite-3-3-8b-instruct');
  });

  it('normalizes streamed text deltas and usage into PlumbStreamEvent', async () => {
    process.env['WATSONX_PROJECT_ID'] = 'proj-1';
    mockTextChatStream.mockResolvedValue(
      makeStream([
        { data: { choices: [{ delta: { content: 'Hello' } }] } },
        { data: { choices: [{ delta: { content: ' there' } }] } },
        {
          data: {
            choices: [{ finish_reason: 'stop' }],
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          },
        },
      ]),
    );
    const mod = await importFresh();
    const events = await drain(
      mod.streamWatsonx({
        model: watsonxModel,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'k',
      }),
    );
    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' there' },
      {
        type: 'usage',
        usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('classifies a 401 response as AUTH_REQUIRED', async () => {
    process.env['WATSONX_PROJECT_ID'] = 'proj-1';
    mockTextChatStream.mockRejectedValue({
      status: 401,
      message: 'Unauthorized',
    });
    const mod = await importFresh();
    const events = await drain(
      mod.streamWatsonx({
        model: watsonxModel,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'k',
      }),
    );
    expect(events).toEqual([
      {
        type: 'error',
        error: { code: 'AUTH_REQUIRED', message: 'Unauthorized' },
      },
    ]);
  });

  it('classifies a 429 response as RATE_LIMITED', async () => {
    process.env['WATSONX_PROJECT_ID'] = 'proj-1';
    mockTextChatStream.mockRejectedValue({
      status: 429,
      message: 'Too Many Requests',
    });
    const mod = await importFresh();
    const events = await drain(
      mod.streamWatsonx({
        model: watsonxModel,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'k',
      }),
    );
    expect(events[0]).toEqual({
      type: 'error',
      error: { code: 'RATE_LIMITED', message: 'Too Many Requests' },
    });
  });

  it('respects cancellation via AbortSignal during streaming', async () => {
    process.env['WATSONX_PROJECT_ID'] = 'proj-1';
    const controller = new AbortController();
    mockTextChatStream.mockResolvedValue(
      (async function* () {
        yield { data: { choices: [{ delta: { content: 'partial' } }] } };
        controller.abort();
        yield {
          data: { choices: [{ delta: { content: 'should not appear' } }] },
        };
      })(),
    );
    const mod = await importFresh();
    const events = await drain(
      mod.streamWatsonx({
        model: watsonxModel,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'k',
        signal: controller.signal,
      }),
    );
    expect(events).toEqual([
      { type: 'text', text: 'partial' },
      { type: 'done', finishReason: 'cancelled' },
    ]);
  });

  it('prefers projectId over spaceId when both are set', async () => {
    process.env['WATSONX_PROJECT_ID'] = 'proj-1';
    process.env['WATSONX_SPACE_ID'] = 'space-1';
    mockTextChatStream.mockResolvedValue(makeStream([]));
    const mod = await importFresh();
    for await (const _e of mod.streamWatsonx({
      model: watsonxModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'k',
    })) {
      // drain
    }
    const [chatParams] = mockTextChatStream.mock.calls[0] as [
      { projectId?: string; spaceId?: string },
    ];
    expect(chatParams.projectId).toBe('proj-1');
    expect(chatParams.spaceId).toBeUndefined();
  });
});

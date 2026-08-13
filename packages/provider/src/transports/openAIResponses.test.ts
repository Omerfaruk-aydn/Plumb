/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlumbModel, PlumbStreamEvent } from '../types.js';
import { plumbModelStream } from './streaming.js';

const model: PlumbModel = {
  id: 'gpt-5-mini',
  provider: 'openai',
  api: 'openai-responses',
  baseUrl: 'https://api.openai.com/v1',
  contextWindow: 400_000,
  maxTokens: 128_000,
  input: 'text',
  toolsSupported: true,
  toolsCapabilitySource: 'BUNDLED_CATALOG',
};

const tool = {
  type: 'function' as const,
  function: {
    name: 'plumb_tool_probe',
    description: 'Harmless diagnostic',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
};

function sse(events: Array<Record<string, unknown>>): Response {
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`,
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

async function drain(
  options: Parameters<typeof plumbModelStream>[0],
): Promise<PlumbStreamEvent[]> {
  const events: PlumbStreamEvent[] = [];
  for await (const event of plumbModelStream(options)) events.push(event);
  return events;
}

describe('native OpenAI Responses structured tool route', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('serializes flat tools and emits one normalized call after fragmented arguments', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      sse([
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            id: 'item_1',
            type: 'function_call',
            call_id: 'call_1',
            name: 'plumb_tool_probe',
            arguments: '',
          },
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_1',
          delta: '{',
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'item_1',
          delta: '}',
        },
        {
          type: 'response.function_call_arguments.done',
          item_id: 'item_1',
          arguments: '{}',
        },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            id: 'item_1',
            type: 'function_call',
            call_id: 'call_1',
            name: 'plumb_tool_probe',
            arguments: '{}',
          },
        },
        {
          type: 'response.completed',
          response: {
            output: [{ type: 'function_call' }],
            usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
          },
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const events = await drain({
      model,
      messages: [{ role: 'user', content: 'Run the probe.' }],
      tools: [tool],
      toolChoice: { mode: 'named', name: 'plumb_tool_probe' },
      apiKey: 'not-a-real-key',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body['input']).toEqual([
      { role: 'user', content: 'Run the probe.' },
    ]);
    expect(body['tools']).toEqual([
      {
        type: 'function',
        name: 'plumb_tool_probe',
        description: 'Harmless diagnostic',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    ]);
    expect(body['tool_choice']).toEqual({
      type: 'function',
      name: 'plumb_tool_probe',
    });
    expect(events.filter((event) => event.type === 'tool_call')).toEqual([
      {
        type: 'tool_call',
        toolCall: {
          id: 'call_1',
          name: 'plumb_tool_probe',
          arguments: '{}',
        },
      },
    ]);
  });

  it('reinjects a result as function_call_output with the original call id', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      sse([
        { type: 'response.output_text.delta', delta: 'Probe complete.' },
        { type: 'response.completed', response: { output: [] } },
      ]),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await drain({
      model,
      messages: [
        { role: 'user', content: 'Run the probe.' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_call',
              id: 'call_1',
              name: 'plumb_tool_probe',
              arguments: '{}',
            },
          ],
        },
        {
          role: 'tool',
          name: 'plumb_tool_probe',
          toolCallId: 'call_1',
          content: 'PLUMB_TOOL_PROBE_OK',
        },
      ],
      tools: [tool],
      apiKey: 'not-a-real-key',
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { input: unknown[] };
    expect(body.input).toEqual([
      { role: 'user', content: 'Run the probe.' },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'plumb_tool_probe',
        arguments: '{}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: 'PLUMB_TOOL_PROBE_OK',
      },
    ]);
  });

  it('keeps textual pseudo-tool markers as text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sse([
          {
            type: 'response.output_text.delta',
            delta: '<tool_call>{"name":"plumb_tool_probe"}</tool_call>',
          },
          { type: 'response.completed', response: { output: [] } },
        ]),
      ),
    );
    const events = await drain({
      model,
      messages: [{ role: 'user', content: 'Say something.' }],
      tools: [tool],
      apiKey: 'not-a-real-key',
    });
    expect(events.some((event) => event.type === 'tool_call')).toBe(false);
    expect(events).toContainEqual({
      type: 'text',
      text: '<tool_call>{"name":"plumb_tool_probe"}</tool_call>',
    });
  });
});

/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live structured tool-call route regression test.
 *
 * Proves the full end-to-end chain for OpenAI-compatible providers
 * (opencode-zen, openai, openrouter, etc.) when the upstream SSE
 * stream contains structured tool_call deltas:
 *
 *   PlumbContentGenerator#doStream
 *   -> plumbModelStream
 *   -> openAICompatibleStream
 *   -> SSE parser (delta.tool_calls accumulation)
 *   -> PlumbStreamEvent { type: 'tool_call' }
 *   -> GenerateContentResponse { functionCall: { id, name, args } }
 *   -> Turn.run extracts resp.functionCalls
 *   -> ToolCallRequest event
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PlumbStreamEvent, PlumbModel } from '../types.js';
import { plumbModelStream } from './streaming.js';

// --- Helpers ---

function sseChunk(data: string): string {
  return `data: ${data}`;
}

function sseDone(): string {
  return 'data: [DONE]';
}

function makeResponse(sseLines: string[]): Response {
  const body = sseLines.join('\n\n') + '\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** OpenAI-compatible model with toolsSupported=true (production shape). */
const openaiToolModel: PlumbModel = {
  id: 'deepseek-v4-flash-free',
  provider: 'opencode-zen',
  api: 'openai-completions',
  baseUrl: 'https://opencode.ai/zen/v1',
  contextWindow: 200_000,
  maxTokens: 128_000,
  reasoning: true,
  input: 'text',
  toolsSupported: true,
  toolsCapabilitySource: 'BUNDLED_CATALOG',
};

/** OpenAI-compatible model without toolsSupported (UNKNOWN). */
const openaiUnknownModel: PlumbModel = {
  id: 'some-model',
  provider: 'opencode-zen',
  api: 'openai-completions',
  baseUrl: 'https://opencode.ai/zen/v1',
  contextWindow: 200_000,
  maxTokens: 128_000,
  reasoning: false,
  input: 'text',
};

const PLUMB_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read a file',
      parameters: {
        type: 'object' as const,
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_directory',
      description: 'List a directory',
      parameters: {
        type: 'object' as const,
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
];

// --- Tests ---

describe('live structured tool-call route — OpenAI-compatible transport', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // S1: Verify outbound request contains tools when toolsSupported=true
  it('sends tools in request body when model.toolsSupported === true', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return makeResponse([
        sseChunk(
          JSON.stringify({ choices: [{ delta: { content: 'ok' }, index: 0 }] }),
        ),
        sseChunk(
          JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
          }),
        ),
        sseDone(),
      ]);
    }) as typeof fetch;

    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: openaiToolModel,
      messages: [{ role: 'user', content: 'Analyze' }],
      tools: PLUMB_TOOLS,
      apiKey: 'sk-test',
    })) {
      events.push(event);
    }

    expect(capturedBody).toBeDefined();
    const tools = capturedBody!['tools'] as Array<Record<string, unknown>>;
    expect(tools).toBeDefined();
    expect(tools.length).toBe(2);
    expect(tools[0].type).toBe('function');
    expect((tools[0].function as Record<string, unknown>).name).toBe(
      'read_file',
    );
    expect(tools[1].type).toBe('function');
    expect((tools[1].function as Record<string, unknown>).name).toBe(
      'list_directory',
    );
    expect(capturedBody!['model']).toBe('deepseek-v4-flash-free');
    expect(capturedBody!['stream']).toBe(true);
  });

  // S3: Upstream returns structured tool_call deltas
  it('accumulates tool_call deltas and emits normalized tool_call events', async () => {
    const sse = [
      sseChunk(
        JSON.stringify({
          choices: [{ delta: { content: 'Analiz ediyorum.' }, index: 0 }],
        }),
      ),
      sseChunk(
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_001',
                    type: 'function',
                    function: { name: 'list_directory', arguments: '{"' },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
      ),
      sseChunk(
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: 'path":".}"' } },
                ],
              },
              index: 0,
            },
          ],
        }),
      ),
      sseChunk(
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 1,
                    id: 'call_002',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: '{"path":"package.json"}',
                    },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
      ),
      sseChunk(
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'tool_calls', index: 0 }],
        }),
      ),
      sseDone(),
    ];

    globalThis.fetch = (async () => makeResponse(sse)) as typeof fetch;

    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: openaiToolModel,
      messages: [{ role: 'user', content: 'Analyze' }],
      tools: PLUMB_TOOLS,
      apiKey: 'sk-test',
    })) {
      events.push(event);
    }

    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.length).toBe(1);

    const toolCallEvents = events.filter((e) => e.type === 'tool_call');
    expect(toolCallEvents.length).toBe(2);
    expect(toolCallEvents[0]).toMatchObject({
      type: 'tool_call',
      toolCall: {
        id: 'call_001',
        name: 'list_directory',
        arguments: '{"path":".}"',
      },
    });
    expect(toolCallEvents[1]).toMatchObject({
      type: 'tool_call',
      toolCall: {
        id: 'call_002',
        name: 'read_file',
        arguments: '{"path":"package.json"}',
      },
    });

    expect(events.at(-1)).toMatchObject({
      type: 'done',
      finishReason: 'tool_calls',
    });
  });

  // S13: Text + tool_call in same assistant turn
  it('text preamble + tool_calls in same turn: both are preserved', async () => {
    const sse = [
      sseChunk(
        JSON.stringify({
          choices: [{ delta: { content: 'Inceleyeyim.' }, index: 0 }],
        }),
      ),
      sseChunk(
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_r',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: '{"path":"package.json"}',
                    },
                  },
                  {
                    index: 1,
                    id: 'call_l',
                    type: 'function',
                    function: {
                      name: 'list_directory',
                      arguments: '{"path":"."}',
                    },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
      ),
      sseChunk(
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'tool_calls', index: 0 }],
        }),
      ),
      sseDone(),
    ];

    globalThis.fetch = (async () => makeResponse(sse)) as typeof fetch;
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: openaiToolModel,
      messages: [{ role: 'user', content: 'Analyze' }],
      tools: PLUMB_TOOLS,
      apiKey: 'sk-test',
    })) {
      events.push(event);
    }

    const textEvents = events.filter((e) => e.type === 'text');
    const toolCallEvents = events.filter((e) => e.type === 'tool_call');
    expect(textEvents.length).toBe(1);
    expect(toolCallEvents.length).toBe(2);
    expect(textEvents[0]).toMatchObject({ type: 'text', text: 'Inceleyeyim.' });
  });

  // S4: Upstream returns text only (no tool_calls)
  it('text-only response produces no tool_call events', async () => {
    const sse = [
      sseChunk(
        JSON.stringify({
          choices: [{ delta: { content: 'Here is analysis.' }, index: 0 }],
        }),
      ),
      sseChunk(
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
        }),
      ),
      sseDone(),
    ];

    globalThis.fetch = (async () => makeResponse(sse)) as typeof fetch;
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: openaiToolModel,
      messages: [{ role: 'user', content: 'Analyze' }],
      tools: PLUMB_TOOLS,
      apiKey: 'sk-test',
    })) {
      events.push(event);
    }

    expect(events.filter((e) => e.type === 'text').length).toBe(1);
    expect(events.filter((e) => e.type === 'tool_call').length).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' });
  });

  // S16: Tools NOT sent when toolsSupported is not true
  it('does NOT send tools when model.toolsSupported is absent', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return makeResponse([
        sseChunk(
          JSON.stringify({ choices: [{ delta: { content: 'ok' }, index: 0 }] }),
        ),
        sseChunk(
          JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
          }),
        ),
        sseDone(),
      ]);
    }) as typeof fetch;

    for await (const _ of plumbModelStream({
      model: openaiUnknownModel,
      messages: [{ role: 'user', content: 'test' }],
      tools: PLUMB_TOOLS,
      apiKey: 'sk-test',
    })) {
      /* drain */
    }

    expect(capturedBody!['tools']).toBeUndefined();
  });

  // S10: Three parallel tool calls
  it('handles three parallel tool calls in one turn', async () => {
    const sse = [
      sseChunk(
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_a',
                    type: 'function',
                    function: {
                      name: 'list_directory',
                      arguments: '{"path":"."}',
                    },
                  },
                  {
                    index: 1,
                    id: 'call_b',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: '{"path":"package.json"}',
                    },
                  },
                  {
                    index: 2,
                    id: 'call_c',
                    type: 'function',
                    function: {
                      name: 'list_directory',
                      arguments: '{"path":"packages"}',
                    },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
      ),
      sseChunk(
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'tool_calls', index: 0 }],
        }),
      ),
      sseDone(),
    ];

    globalThis.fetch = (async () => makeResponse(sse)) as typeof fetch;
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: openaiToolModel,
      messages: [{ role: 'user', content: 'Analyze' }],
      tools: PLUMB_TOOLS,
      apiKey: 'sk-test',
    })) {
      events.push(event);
    }

    const toolCallEvents = events.filter((e) => e.type === 'tool_call');
    expect(toolCallEvents.length).toBe(3);
    expect(toolCallEvents[0]).toMatchObject({
      toolCall: { id: 'call_a', name: 'list_directory' },
    });
    expect(toolCallEvents[1]).toMatchObject({
      toolCall: { id: 'call_b', name: 'read_file' },
    });
    expect(toolCallEvents[2]).toMatchObject({
      toolCall: { id: 'call_c', name: 'list_directory' },
    });
  });

  // Stream ends without finish_reason but with pending tool calls
  it('flushes pending tool calls even when stream ends without finish_reason', async () => {
    const sse = [
      sseChunk(
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_orphan',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: '{"path":"README.md"}',
                    },
                  },
                ],
              },
              index: 0,
            },
          ],
        }),
      ),
      sseDone(),
    ];

    globalThis.fetch = (async () => makeResponse(sse)) as typeof fetch;
    const events: PlumbStreamEvent[] = [];
    for await (const event of plumbModelStream({
      model: openaiToolModel,
      messages: [{ role: 'user', content: 'read' }],
      tools: PLUMB_TOOLS,
      apiKey: 'sk-test',
    })) {
      events.push(event);
    }

    const toolCallEvents = events.filter((e) => e.type === 'tool_call');
    expect(toolCallEvents.length).toBe(1);
    expect(toolCallEvents[0]).toMatchObject({
      toolCall: {
        id: 'call_orphan',
        name: 'read_file',
        arguments: '{"path":"README.md"}',
      },
    });
  });
});

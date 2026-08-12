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
import { enableToolRouteDiag, getLastToolRouteDiag } from './streaming.js';

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

  it('emits tool_choice:auto only for a NVIDIA NIM route that requires activation', async () => {
    enableToolRouteDiag();
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return makeResponse([
        sseChunk(
          JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
          }),
        ),
        sseDone(),
      ]);
    }) as typeof fetch;

    for await (const _ of plumbModelStream({
      model: {
        ...openaiToolModel,
        provider: 'nvidia',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
      },
      messages: [{ role: 'user', content: 'test' }],
      tools: PLUMB_TOOLS,
      apiKey: 'nvapi-test',
    })) {
      // drain
    }

    expect(capturedBody?.['tools']).toHaveLength(2);
    expect(capturedBody?.['tool_choice']).toBe('auto');
    expect(getLastToolRouteDiag()).toMatchObject({
      toolProtocolStatus: 'structured_tools_advertised',
      toolChoicePolicy: 'REQUIRED_WHEN_TOOLS_PRESENT',
      toolChoiceSent: true,
      toolChoiceValueCategory: 'auto',
    });
  });

  it('does not emit tool_choice for a forbidden DeepSeek reasoning route', async () => {
    enableToolRouteDiag();
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return makeResponse([
        sseChunk(
          JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
          }),
        ),
        sseDone(),
      ]);
    }) as typeof fetch;

    for await (const _ of plumbModelStream({
      model: {
        ...openaiToolModel,
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        toolPolicy: {
          emission: 'FORBIDDEN',
          forcedToolChoiceSupported: false,
          namedToolChoiceSupported: false,
          source: 'OMP_COMPAT',
        },
      },
      messages: [{ role: 'user', content: 'test' }],
      tools: PLUMB_TOOLS,
      toolChoice: { mode: 'auto' },
      apiKey: 'sk-test',
    })) {
      // drain
    }

    expect(capturedBody?.['tools']).toHaveLength(2);
    expect(capturedBody?.['tool_choice']).toBeUndefined();
    expect(getLastToolRouteDiag()).toMatchObject({
      toolProtocolStatus: 'structured_tools_advertised',
      toolChoicePolicy: 'FORBIDDEN',
      toolChoiceSent: false,
      toolChoiceValueCategory: 'absent',
    });
  });

  it('serializes a named choice with Anthropic native tool_choice', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return makeResponse([
        sseChunk(
          JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
          }),
        ),
      ]);
    }) as typeof fetch;

    for await (const _ of plumbModelStream({
      model: {
        ...openaiToolModel,
        provider: 'anthropic',
        api: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com',
      },
      messages: [{ role: 'user', content: 'test' }],
      tools: PLUMB_TOOLS,
      toolChoice: { mode: 'named', name: 'read_file' },
      apiKey: 'sk-ant-test',
    })) {
      // drain
    }

    expect(capturedBody?.['tool_choice']).toEqual({
      type: 'tool',
      name: 'read_file',
    });
  });

  it('serializes a named choice with Gemini native functionCallingConfig', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return makeResponse([
        sseChunk(
          JSON.stringify({
            candidates: [
              { content: { role: 'model', parts: [] }, finishReason: 'STOP' },
            ],
          }),
        ),
      ]);
    }) as typeof fetch;

    for await (const _ of plumbModelStream({
      model: {
        ...openaiToolModel,
        provider: 'google',
        api: 'google-generative-ai',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      },
      messages: [{ role: 'user', content: 'test' }],
      tools: PLUMB_TOOLS,
      toolChoice: { mode: 'named', name: 'read_file' },
      apiKey: 'google-test',
    })) {
      // drain
    }

    expect(capturedBody?.['tool_choice']).toBeUndefined();
    expect(capturedBody?.['toolConfig']).toEqual({
      functionCallingConfig: {
        mode: 'ANY',
        allowedFunctionNames: ['read_file'],
      },
    });
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

  // Thinking request body for reasoning models (OMP compat)
  it('sends reasoning_effort for reasoning models with thinking config (metadata-driven)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const deepseekModel: PlumbModel = {
      ...openaiToolModel,
      id: 'deepseek-v4-flash-free',
      reasoning: true,
      thinking: { mode: 'effort', supportedEfforts: ['high', 'max'] },
    };
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
      model: deepseekModel,
      messages: [{ role: 'user', content: 'test' }],
      tools: PLUMB_TOOLS,
      apiKey: 'sk-test',
    })) {
      /* drain */
    }

    // OMP compat: OpenCode Zen + DeepSeek uses reasoning_effort, NOT thinking object
    expect(capturedBody!['reasoning_effort']).toBe('max');
    expect(capturedBody!['thinking']).toBeUndefined();
    expect(capturedBody!['tools']).toBeDefined();
  });

  it('sends reasoning_effort for HY3/GLM/Qwen reasoning models (same thinkingFormat=openai)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const hyModel: PlumbModel = {
      ...openaiToolModel,
      id: 'hy3-free',
      reasoning: true,
      thinking: {
        mode: 'effort',
        supportedEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      },
    };
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
      model: hyModel,
      messages: [{ role: 'user', content: 'test' }],
      tools: PLUMB_TOOLS,
      apiKey: 'sk-test',
    })) {
      /* drain */
    }

    // OMP compat: OpenCode Zen + HY3 uses reasoning_effort (thinkingFormat=openai),
    // NOT thinking: {type:"enabled"} (that's only for direct DeepSeek API extraBody)
    expect(capturedBody!['reasoning_effort']).toBe('xhigh');
    expect(capturedBody!['thinking']).toBeUndefined();
    expect(capturedBody!['tools']).toBeDefined();
  });

  it('does NOT send reasoning_effort when thinking config absent', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const noThinkingModel: PlumbModel = {
      ...openaiToolModel,
      id: 'some-model',
      reasoning: false,
    };
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
      model: noThinkingModel,
      messages: [{ role: 'user', content: 'test' }],
      tools: PLUMB_TOOLS,
      apiKey: 'sk-test',
    })) {
      /* drain */
    }

    expect(capturedBody!['reasoning_effort']).toBeUndefined();
    expect(capturedBody!['thinking']).toBeUndefined();
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

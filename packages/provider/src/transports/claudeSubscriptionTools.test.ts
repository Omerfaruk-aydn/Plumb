/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests the Claude Subscription tool-authority ADAPTER in isolation:
 * schema conversion, MCP server registration, and the
 * request/executor/result round-trip. The real CoreToolScheduler
 * execution authority (packages/core) is exercised separately in
 * packages/core's own tests — here the executor is a controllable fake,
 * proving the adapter calls it exactly once per tool invocation and
 * faithfully translates both directions, never executing anything itself.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type {
  PlumbModel,
  PlumbStreamEvent,
  PlumbTool,
  PlumbToolExecutionRequest,
  PlumbToolExecutionResult,
} from '../types.js';

interface CapturedSdkTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (
    args: Record<string, unknown>,
    extra: unknown,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
}

const capturedTools: CapturedSdkTool[] = [];
const mockQuery = vi.fn();
const mockTool = vi.fn(
  (
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: CapturedSdkTool['handler'],
  ) => {
    const captured = { name, description, schema, handler };
    capturedTools.push(captured);
    return captured;
  },
);
const mockCreateSdkMcpServer = vi.fn(
  (options: { name: string; tools?: unknown[] }) => ({
    type: 'sdk' as const,
    name: options.name,
    instance: options.tools,
  }),
);

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  tool: (...args: Parameters<typeof mockTool>) => mockTool(...args),
  createSdkMcpServer: (...args: Parameters<typeof mockCreateSdkMcpServer>) =>
    mockCreateSdkMcpServer(...args),
}));

async function importFresh() {
  vi.resetModules();
  const mod = await import('./claudeSubscription.js');
  mod.__resetClaudeAgentSdkCacheForTests();
  return mod;
}

function makeSdkQuery(messages: unknown[]) {
  const query = (async function* () {
    for (const m of messages) yield m;
  })() as AsyncGenerator<unknown> & { close?: () => void };
  query.close = vi.fn();
  return query;
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

const readFileTool: PlumbTool = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read a file from disk',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['path'],
    },
  },
};

async function drain(
  gen: AsyncGenerator<PlumbStreamEvent>,
): Promise<PlumbStreamEvent[]> {
  const events: PlumbStreamEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('Claude Subscription tool-authority adapter', () => {
  afterEach(() => {
    vi.resetAllMocks();
    capturedTools.length = 0;
  });

  it('registers PLUMB tools as an in-process MCP server and raises maxTurns, without ever enabling SDK built-in tools', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([{ type: 'result', subtype: 'success' }]),
    );
    const executor =
      vi.fn<
        (r: PlumbToolExecutionRequest) => Promise<PlumbToolExecutionResult>
      >();
    const mod = await importFresh();

    for await (const _e of mod.streamClaudeSubscription({
      model: subscriptionModel,
      messages: [{ role: 'user', content: 'read foo.txt' }],
      apiKey: '',
      tools: [readFileTool],
      toolExecutor: executor,
    })) {
      // drain
    }

    expect(mockCreateSdkMcpServer).toHaveBeenCalledTimes(1);
    expect(mockTool).toHaveBeenCalledTimes(1);
    expect(mockTool.mock.calls[0]![0]).toBe('read_file');

    const [callArgs] = mockQuery.mock.calls[0] as [
      { options: Record<string, unknown> },
    ];
    expect(callArgs.options['tools']).toEqual([]);
    expect(callArgs.options['mcpServers']).toBeDefined();
    expect(callArgs.options['maxTurns']).toBe(10);
  });

  it('does not register an MCP server when tools is empty, even with an executor supplied', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([{ type: 'result', subtype: 'success' }]),
    );
    const executor = vi.fn();
    const mod = await importFresh();

    for await (const _e of mod.streamClaudeSubscription({
      model: subscriptionModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
      tools: [],
      toolExecutor: executor,
    })) {
      // drain
    }

    expect(mockCreateSdkMcpServer).not.toHaveBeenCalled();
    const [callArgs] = mockQuery.mock.calls[0] as [
      { options: Record<string, unknown> },
    ];
    expect(callArgs.options['mcpServers']).toBeUndefined();
    expect(callArgs.options['maxTurns']).toBe(1);
  });

  it('does not register an MCP server when tools are present but no executor is supplied', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([{ type: 'result', subtype: 'success' }]),
    );
    const mod = await importFresh();

    for await (const _e of mod.streamClaudeSubscription({
      model: subscriptionModel,
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: '',
      tools: [readFileTool],
    })) {
      // drain
    }

    expect(mockCreateSdkMcpServer).not.toHaveBeenCalled();
  });

  it('converts a successful executor result into the SDK CallToolResult shape (isError: false)', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([{ type: 'result', subtype: 'success' }]),
    );
    const executor = vi
      .fn<(r: PlumbToolExecutionRequest) => Promise<PlumbToolExecutionResult>>()
      .mockResolvedValue({
        status: 'success',
        content: 'file contents here',
        isError: false,
      });
    const mod = await importFresh();

    for await (const _e of mod.streamClaudeSubscription({
      model: subscriptionModel,
      messages: [{ role: 'user', content: 'read foo.txt' }],
      apiKey: '',
      tools: [readFileTool],
      toolExecutor: executor,
    })) {
      // drain
    }

    const [captured] = capturedTools;
    expect(captured).toBeDefined();
    const callResult = await captured!.handler({ path: 'foo.txt' }, {});

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith({
      toolName: 'read_file',
      args: { path: 'foo.txt' },
      toolCallId: expect.stringContaining('read_file:'),
    });
    expect(callResult).toEqual({
      content: [{ type: 'text', text: 'file contents here' }],
      isError: false,
    });
  });

  it('converts a denied/error executor result into isError: true without throwing', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([{ type: 'result', subtype: 'success' }]),
    );
    const executor = vi
      .fn<(r: PlumbToolExecutionRequest) => Promise<PlumbToolExecutionResult>>()
      .mockResolvedValue({
        status: 'error',
        content: 'Permission denied by user.',
        isError: true,
      });
    const mod = await importFresh();

    for await (const _e of mod.streamClaudeSubscription({
      model: subscriptionModel,
      messages: [{ role: 'user', content: 'read foo.txt' }],
      apiKey: '',
      tools: [readFileTool],
      toolExecutor: executor,
    })) {
      // drain
    }

    const [captured] = capturedTools;
    const callResult = await captured!.handler({ path: 'foo.txt' }, {});
    expect(callResult.isError).toBe(true);
    expect(callResult.content[0]!.text).toBe('Permission denied by user.');
  });

  it('calls the executor exactly once per tool invocation, even for two separate calls to the same tool', async () => {
    mockQuery.mockReturnValue(
      makeSdkQuery([{ type: 'result', subtype: 'success' }]),
    );
    const executor = vi
      .fn<(r: PlumbToolExecutionRequest) => Promise<PlumbToolExecutionResult>>()
      .mockResolvedValue({ status: 'success', content: 'ok', isError: false });
    const mod = await importFresh();

    for await (const _e of mod.streamClaudeSubscription({
      model: subscriptionModel,
      messages: [{ role: 'user', content: 'read two files' }],
      apiKey: '',
      tools: [readFileTool],
      toolExecutor: executor,
    })) {
      // drain
    }

    const [captured] = capturedTools;
    await captured!.handler({ path: 'a.txt' }, {});
    await captured!.handler({ path: 'b.txt' }, {});

    expect(executor).toHaveBeenCalledTimes(2);
    // Distinct correlation ids — never reusing/duplicating the same call id.
    const ids = executor.mock.calls.map((c) => c[0].toolCallId);
    expect(new Set(ids).size).toBe(2);
  });

  it('gracefully registers no MCP server when the installed SDK build lacks tool()/createSdkMcpServer', async () => {
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: (...args: unknown[]) => mockQuery(...args),
      // Explicitly absent — simulates an older/partial SDK build.
      tool: undefined,
      createSdkMcpServer: undefined,
    }));
    mockQuery.mockReturnValue(
      makeSdkQuery([{ type: 'result', subtype: 'success' }]),
    );
    const executor = vi.fn();
    const mod = await importFresh();

    const events = await drain(
      mod.streamClaudeSubscription({
        model: subscriptionModel,
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: '',
        tools: [readFileTool],
        toolExecutor: executor,
      }),
    );

    expect(events.some((e) => e.type === 'error')).toBe(false);
    const [callArgs] = mockQuery.mock.calls[0] as [
      { options: Record<string, unknown> },
    ];
    expect(callArgs.options['mcpServers']).toBeUndefined();
    expect(executor).not.toHaveBeenCalled();

    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: (...args: unknown[]) => mockQuery(...args),
      tool: (...args: Parameters<typeof mockTool>) => mockTool(...args),
      createSdkMcpServer: (
        ...args: Parameters<typeof mockCreateSdkMcpServer>
      ) => mockCreateSdkMcpServer(...args),
    }));
  });
});

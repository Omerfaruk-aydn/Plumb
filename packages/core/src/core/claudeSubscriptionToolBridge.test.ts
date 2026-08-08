/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression: createClaudeSubscriptionToolExecutor must route every call
 * through the REAL scheduleAgentTools()/Scheduler pipeline — the same one
 * every other agent-tool caller in this codebase uses — never a second,
 * Claude-specific execution path. Only the Scheduler class itself is
 * mocked (the true execution/network/UI boundary); scheduleAgentTools
 * runs for real, exercising the actual request-building logic.
 */
import { describe, it, expect, vi, beforeEach, type Mocked } from 'vitest';
import { createClaudeSubscriptionToolExecutor } from './claudeSubscriptionToolBridge.js';
import { Scheduler } from '../scheduler/scheduler.js';
import { CoreToolCallStatus } from '../scheduler/types.js';
import type { Config } from '../config/config.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { CompletedToolCall } from '../scheduler/types.js';

const mockSchedule = vi.fn();
const mockDispose = vi.fn();

vi.mock('../scheduler/scheduler.js', () => ({
  Scheduler: vi.fn().mockImplementation(() => ({
    schedule: mockSchedule,
    dispose: mockDispose,
  })),
}));

describe('createClaudeSubscriptionToolExecutor', () => {
  let mockConfig: Mocked<Config>;
  let mockToolRegistry: Mocked<ToolRegistry>;
  let signal: AbortSignal;

  beforeEach(() => {
    vi.mocked(Scheduler).mockClear();
    mockSchedule.mockReset();
    mockDispose.mockReset();
    mockToolRegistry = {
      messageBus: {},
    } as unknown as Mocked<ToolRegistry>;
    mockConfig = {
      getToolRegistry: vi.fn().mockReturnValue(mockToolRegistry),
      getPromptRegistry: vi.fn(),
      getResourceRegistry: vi.fn(),
      promptId: 'p',
      geminiClient: {},
      sandboxManager: undefined,
    } as unknown as Mocked<Config>;
    signal = new AbortController().signal;
  });

  it('routes exactly one real Scheduler invocation per executor call, with the request built from the given tool name/args', async () => {
    const successResult: CompletedToolCall = {
      status: CoreToolCallStatus.Success,
      request: {
        callId: 'x',
        name: 'read_file',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
      tool: {} as never,
      invocation: {} as never,
      response: {
        callId: 'x',
        responseParts: [{ text: 'file contents' }],
        resultDisplay: undefined,
        error: undefined,
        errorType: undefined,
      },
    };
    mockSchedule.mockResolvedValue([successResult]);

    const executor = createClaudeSubscriptionToolExecutor(
      mockConfig,
      'prompt-1',
      signal,
    );
    const result = await executor({
      toolName: 'read_file',
      args: { path: 'foo.txt' },
      toolCallId: 'read_file:0',
    });

    expect(Scheduler).toHaveBeenCalledTimes(1);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockDispose).toHaveBeenCalledTimes(1);

    const [requests, scheduledSignal] = mockSchedule.mock.calls[0];
    expect(requests).toEqual([
      expect.objectContaining({
        name: 'read_file',
        args: { path: 'foo.txt' },
        prompt_id: 'prompt-1',
        isClientInitiated: false,
      }),
    ]);
    expect(scheduledSignal).toBe(signal);

    expect(result).toEqual({
      status: 'success',
      content: 'file contents',
      isError: false,
    });
  });

  it('maps a Cancelled scheduler outcome (user denial or abort) to a cancelled/isError result, never success', async () => {
    const cancelled: CompletedToolCall = {
      status: CoreToolCallStatus.Cancelled,
      request: {
        callId: 'x',
        name: 'run_shell_command',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
      tool: {} as never,
      invocation: {} as never,
      response: {
        callId: 'x',
        responseParts: [],
        resultDisplay: undefined,
        error: new Error('User rejected the confirmation.'),
        errorType: undefined,
      },
    };
    mockSchedule.mockResolvedValue([cancelled]);

    const executor = createClaudeSubscriptionToolExecutor(
      mockConfig,
      'prompt-1',
      signal,
    );
    const result = await executor({
      toolName: 'run_shell_command',
      args: { command: 'rm -rf /' },
      toolCallId: 'run_shell_command:0',
    });

    expect(result.status).toBe('cancelled');
    expect(result.isError).toBe(true);
    expect(result.content).toContain('rejected');
  });

  it('maps an Error scheduler outcome to an error/isError result', async () => {
    const errored: CompletedToolCall = {
      status: CoreToolCallStatus.Error,
      request: {
        callId: 'x',
        name: 'read_file',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
      response: {
        callId: 'x',
        responseParts: [],
        resultDisplay: undefined,
        error: new Error('ENOENT: no such file'),
        errorType: undefined,
      },
    };
    mockSchedule.mockResolvedValue([errored]);

    const executor = createClaudeSubscriptionToolExecutor(
      mockConfig,
      'prompt-1',
      signal,
    );
    const result = await executor({
      toolName: 'read_file',
      args: { path: 'missing.txt' },
      toolCallId: 'read_file:0',
    });

    expect(result.status).toBe('error');
    expect(result.isError).toBe(true);
    expect(result.content).toContain('ENOENT');
  });

  it('two calls to the executor produce two independent Scheduler instances, each disposed — no shared/leaked scheduler state', async () => {
    mockSchedule.mockResolvedValue([
      {
        status: CoreToolCallStatus.Success,
        request: {
          callId: 'x',
          name: 't',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
        tool: {} as never,
        invocation: {} as never,
        response: {
          callId: 'x',
          responseParts: [],
          resultDisplay: undefined,
          error: undefined,
          errorType: undefined,
        },
      },
    ]);

    const executor = createClaudeSubscriptionToolExecutor(
      mockConfig,
      'prompt-1',
      signal,
    );
    await executor({ toolName: 't', args: {}, toolCallId: 't:0' });
    await executor({ toolName: 't', args: {}, toolCallId: 't:1' });

    expect(Scheduler).toHaveBeenCalledTimes(2);
    expect(mockDispose).toHaveBeenCalledTimes(2);
    // Distinct schedulerId per call — never reused across calls.
    const ids = vi
      .mocked(Scheduler)
      .mock.calls.map((c) => (c[0] as { schedulerId: string }).schedulerId);
    expect(new Set(ids).size).toBe(2);
  });
});

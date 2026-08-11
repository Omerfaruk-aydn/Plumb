/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression: createClaudeSubscriptionToolExecutor must route every call
 * through the REAL Scheduler pipeline — the same one every other agent-tool
 * caller in this codebase uses — never a second, Claude-specific execution
 * path. Only the Scheduler class itself is mocked (the true
 * execution/network/UI boundary); the executor's own request-building and
 * scheduler-lifecycle logic runs for real.
 *
 * Also covers the interactive-UI visibility regression this bridge used to
 * cause: a fresh, uniquely-IDed Scheduler per tool call made every call look
 * like a brand-new, unrelated "subagent" scheduler to the CLI's
 * useToolScheduler hook, which hides non-root schedulers unless they need
 * approval — so ordinary auto-approved reads/searches during a Claude
 * Subscription turn never appeared in the terminal UI at all, even though
 * they executed for real. The fix is to reuse ONE Scheduler per turn under
 * the shared `PROVIDER_INTERNAL_SCHEDULER_ID`, so the UI can recognize and
 * always show them (see useToolScheduler.test.ts for the UI-side half).
 */
import { describe, it, expect, vi, beforeEach, type Mocked } from 'vitest';
import { createClaudeSubscriptionToolExecutor } from './claudeSubscriptionToolBridge.js';
import { Scheduler } from '../scheduler/scheduler.js';
import {
  CoreToolCallStatus,
  PROVIDER_INTERNAL_SCHEDULER_ID,
} from '../scheduler/types.js';
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

function successResult(
  callId: string,
  text = 'file contents',
): CompletedToolCall {
  return {
    status: CoreToolCallStatus.Success,
    request: {
      callId,
      name: 'read_file',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    },
    tool: {} as never,
    invocation: {} as never,
    response: {
      callId,
      responseParts: [{ text }],
      resultDisplay: undefined,
      error: undefined,
      errorType: undefined,
    },
  };
}

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

  it('routes exactly one real Scheduler.schedule() invocation per executor call, with the request built from the given tool name/args', async () => {
    mockSchedule.mockResolvedValue([successResult('x')]);

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

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockDispose).not.toHaveBeenCalled();

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

  it('reuses ONE Scheduler instance across every call from the same executor, tagged PROVIDER_INTERNAL_SCHEDULER_ID, so the UI sees the whole turn under one scheduler', async () => {
    mockSchedule
      .mockResolvedValueOnce([successResult('x')])
      .mockResolvedValueOnce([successResult('y')]);

    const executor = createClaudeSubscriptionToolExecutor(
      mockConfig,
      'prompt-1',
      signal,
    );
    await executor({ toolName: 't', args: {}, toolCallId: 't:0' });
    await executor({ toolName: 't', args: {}, toolCallId: 't:1' });

    // Exactly one Scheduler was constructed for the whole turn, not one per call.
    expect(Scheduler).toHaveBeenCalledTimes(1);
    expect(mockSchedule).toHaveBeenCalledTimes(2);

    const options = vi.mocked(Scheduler).mock.calls[0][0] as {
      schedulerId: string;
    };
    expect(options.schedulerId).toBe(PROVIDER_INTERNAL_SCHEDULER_ID);
  });

  it('disposes the turn Scheduler when the turn AbortSignal fires, never mid-turn', async () => {
    mockSchedule.mockResolvedValue([successResult('x')]);
    const controller = new AbortController();

    const executor = createClaudeSubscriptionToolExecutor(
      mockConfig,
      'prompt-1',
      controller.signal,
    );
    await executor({ toolName: 't', args: {}, toolCallId: 't:0' });
    expect(mockDispose).not.toHaveBeenCalled();

    controller.abort();
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });

  it('two separate executors (e.g. two different turns) get two independent Scheduler instances', async () => {
    mockSchedule.mockResolvedValue([successResult('x')]);

    const executorA = createClaudeSubscriptionToolExecutor(
      mockConfig,
      'prompt-1',
      signal,
    );
    const executorB = createClaudeSubscriptionToolExecutor(
      mockConfig,
      'prompt-2',
      new AbortController().signal,
    );
    await executorA({ toolName: 't', args: {}, toolCallId: 't:0' });
    await executorB({ toolName: 't', args: {}, toolCallId: 't:0' });

    expect(Scheduler).toHaveBeenCalledTimes(2);
  });
});

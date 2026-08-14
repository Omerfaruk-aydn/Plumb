/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Part } from '@google/genai';
import type {
  PlumbToolExecutionRequest,
  PlumbToolExecutionResult,
  PlumbToolExecutor,
} from '@plumb/provider';
import type { Config } from '../config/config.js';
import { Scheduler } from '../scheduler/scheduler.js';
import {
  CoreToolCallStatus,
  PROVIDER_INTERNAL_SCHEDULER_ID,
  type ToolCallRequestInfo,
} from '../scheduler/types.js';

/**
 * Extracts human/model-readable text from a completed tool call's
 * `responseParts` (a `Part[]`, the same shape every other transport in
 * this codebase already flattens `functionResponse` parts from — see
 * plumbContentGenerator.ts's `#convertMessages`). Never throws on an
 * unexpected shape; degrades to an empty string instead.
 */
function extractResponseText(responseParts: Part[]): string {
  const texts: string[] = [];
  for (const part of responseParts) {
    const p = part as {
      text?: string;
      functionResponse?: { response?: unknown };
    };
    if (typeof p.text === 'string') {
      texts.push(p.text);
    } else if (p.functionResponse) {
      texts.push(JSON.stringify(p.functionResponse.response ?? {}));
    }
  }
  return texts.join('\n');
}

/**
 * Builds a `PlumbToolExecutor` bound to one real chat turn (`promptId`,
 * `signal`). Every invocation routes through the real, single
 * CoreToolScheduler-backed pipeline (permission evaluation, confirmation UX,
 * execution, cancellation) every other agent/tool caller in this codebase
 * already uses. This function does not execute anything itself; it only
 * adapts request/response shapes.
 *
 * ONE Scheduler instance is created per turn and reused across every tool
 * call the Claude Agent SDK subprocess makes during that turn (rather than a
 * fresh one-shot Scheduler per call, as `scheduleAgentTools()` gives real
 * background subagents). `SchedulerStateManager.getSnapshot()` accumulates
 * completed/active/queued calls for the lifetime of the Scheduler instance,
 * so reusing it is what lets the interactive UI display the whole turn's
 * tool activity — not just the most recent call — under one scheduler ID.
 * It is tagged `PROVIDER_INTERNAL_SCHEDULER_ID`, not `ROOT_SCHEDULER_ID`, so
 * the UI can tell these calls apart from calls PLUMB's own top-level
 * function-calling loop schedules (see `useToolScheduler.ts`), while still
 * always showing them — unlike real subagent schedulers, which stay hidden
 * unless awaiting approval.
 */
export function createClaudeSubscriptionToolExecutor(
  config: Config,
  promptId: string,
  signal: AbortSignal,
): PlumbToolExecutor {
  let callSeq = 0;
  const toolRegistry = config.getToolRegistry();

  const scheduler = new Scheduler({
    context: {
      config,
      promptId: config.promptId,
      toolRegistry,
      promptRegistry: config.getPromptRegistry(),
      resourceRegistry: config.getResourceRegistry(),
      messageBus: toolRegistry.messageBus,
      geminiClient: config.geminiClient,
      sandboxManager: config.sandboxManager,
    },
    messageBus: toolRegistry.messageBus,
    getPreferredEditor: () => undefined,
    schedulerId: PROVIDER_INTERNAL_SCHEDULER_ID,
  });
  signal.addEventListener('abort', () => scheduler.dispose(), { once: true });

  return async (
    request: PlumbToolExecutionRequest,
  ): Promise<PlumbToolExecutionResult> => {
    const callId = `claude-subscription:${promptId}:${callSeq++}:${request.toolCallId}`;

    const toolCallRequest: ToolCallRequestInfo = {
      callId,
      name: request.toolName,
      args: request.args,
      isClientInitiated: false,
      prompt_id: promptId,
    };

    const results = await scheduler.schedule([toolCallRequest], signal);

    const result = results[0];
    if (!result) {
      return {
        status: 'error',
        content: 'Tool call produced no result from the scheduler.',
        isError: true,
      };
    }

    switch (result.status) {
      case CoreToolCallStatus.Success:
        return {
          status: 'success',
          content: extractResponseText(result.response.responseParts),
          isError: false,
        };
      case CoreToolCallStatus.Cancelled:
        return {
          status: 'cancelled',
          content:
            result.response.error?.message ??
            'Tool execution was cancelled or denied by the user.',
          isError: true,
        };
      case CoreToolCallStatus.Error:
      default:
        return {
          status: 'error',
          content: result.response.error?.message ?? 'Tool execution failed.',
          isError: true,
        };
    }
  };
}

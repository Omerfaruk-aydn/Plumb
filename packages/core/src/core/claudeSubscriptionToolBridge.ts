/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Claude Subscription tool-authority bridge.
 *
 * CLAUDE_SUBSCRIPTION_TOOL_AUTHORITY: PLUMB_CORE_TOOL_SCHEDULER
 *
 * `packages/provider` cannot import this package (the dependency runs the
 * other way: core depends on provider), so
 * `transports/claudeSubscription.ts`'s in-process MCP tool adapter can only
 * translate its own SDK-native tool-call shape into the generic
 * `PlumbToolExecutionRequest`/`PlumbToolExecutionResult` types and delegate
 * to a caller-supplied `PlumbToolExecutor`. This module IS that caller: it
 * is the only place a real `PlumbToolExecutor` gets constructed, and it
 * does so by calling the exact same `scheduleAgentTools()` /
 * `Scheduler` real tool-execution pipeline every other agent-tool caller in
 * this codebase already uses (see `agents/agent-scheduler.ts`) — never a
 * second, Claude-specific execution engine, and never a bypass of the real
 * permission/confirmation pipeline.
 *
 * One call to the returned executor = one `scheduleAgentTools()` call with
 * exactly one request = one real `CoreToolCallStatus` outcome = one
 * translated `PlumbToolExecutionResult`.
 */
import type { Part } from '@google/genai';
import type {
  PlumbToolExecutionRequest,
  PlumbToolExecutionResult,
  PlumbToolExecutor,
} from '@google/gemini-cli-provider';
import type { Config } from '../config/config.js';
import { scheduleAgentTools } from '../agents/agent-scheduler.js';
import {
  CoreToolCallStatus,
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
 * `signal`). Every invocation routes through `scheduleAgentTools()` — the
 * same real, single CoreToolScheduler-backed pipeline (permission
 * evaluation, confirmation UX, execution, cancellation) every other
 * agent/tool caller in this codebase already uses. This function does not
 * execute anything itself; it only adapts request/response shapes.
 */
export function createClaudeSubscriptionToolExecutor(
  config: Config,
  promptId: string,
  signal: AbortSignal,
): PlumbToolExecutor {
  let callSeq = 0;

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

    const results = await scheduleAgentTools(config, [toolCallRequest], {
      schedulerId: `claude-subscription:${callId}`,
      toolRegistry: config.getToolRegistry(),
      signal,
    });

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

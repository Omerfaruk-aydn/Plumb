/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ExecuteOptions,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';

export const PLUMB_TOOL_PROBE_NAME = 'plumb_tool_probe';
export const PLUMB_TOOL_PROBE_RESULT = 'PLUMB_TOOL_PROBE_OK';

export type PlumbToolProbeParams = Record<string, never>;

class PlumbToolProbeInvocation extends BaseToolInvocation<
  PlumbToolProbeParams,
  ToolResult
> {
  getDescription(): string {
    return 'Run the side-effect-free PLUMB structured tool protocol probe.';
  }

  async execute(_options: ExecuteOptions): Promise<ToolResult> {
    return {
      llmContent: PLUMB_TOOL_PROBE_RESULT,
      returnDisplay: PLUMB_TOOL_PROBE_RESULT,
    };
  }
}

/** Diagnostic-only, deterministic, zero-side-effect tool. */
export class PlumbToolProbe extends BaseDeclarativeTool<
  PlumbToolProbeParams,
  ToolResult
> {
  constructor(messageBus: MessageBus) {
    super(
      PLUMB_TOOL_PROBE_NAME,
      'PLUMB Tool Probe',
      'Runs a deterministic diagnostic with no filesystem, process, or network side effects.',
      Kind.Read,
      { type: 'object', properties: {}, additionalProperties: false },
      messageBus,
      false,
      false,
    );
  }

  protected createInvocation(
    params: PlumbToolProbeParams,
    messageBus: MessageBus,
    toolName?: string,
    displayName?: string,
  ): ToolInvocation<PlumbToolProbeParams, ToolResult> {
    return new PlumbToolProbeInvocation(
      params,
      messageBus,
      toolName,
      displayName,
    );
  }
}

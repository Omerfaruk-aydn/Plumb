/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EDIT_DISPLAY_NAME,
  GLOB_DISPLAY_NAME,
  WEB_SEARCH_DISPLAY_NAME,
  READ_FILE_DISPLAY_NAME,
  LS_DISPLAY_NAME,
  GREP_DISPLAY_NAME,
  WEB_FETCH_DISPLAY_NAME,
  WRITE_FILE_DISPLAY_NAME,
  READ_MANY_FILES_DISPLAY_NAME,
} from '@plumb/core';
import { CoreToolCallStatus } from '../types.js';
import type { IndividualToolCallDisplay } from '../types.js';
import { isShellTool } from '../components/messages/ToolShared.js';

/**
 * Buckets a finished tool call into a coarse, human-readable category for
 * the collapsed group summary line. Order matters: checked top to bottom.
 */
function categorize(tool: IndividualToolCallDisplay): string {
  const name = tool.originalRequestName ?? tool.name;
  if (
    name === READ_FILE_DISPLAY_NAME ||
    name === READ_MANY_FILES_DISPLAY_NAME
  ) {
    return 'read';
  }
  if (name === LS_DISPLAY_NAME || name === GLOB_DISPLAY_NAME) {
    return 'listed';
  }
  if (name === GREP_DISPLAY_NAME || name === WEB_SEARCH_DISPLAY_NAME) {
    return 'searched';
  }
  if (name === WEB_FETCH_DISPLAY_NAME) {
    return 'fetched';
  }
  if (name === EDIT_DISPLAY_NAME || name === WRITE_FILE_DISPLAY_NAME) {
    return 'edited';
  }
  if (isShellTool(name)) {
    return 'ran';
  }
  return 'other';
}

const CATEGORY_LABELS: Record<string, (count: number) => string> = {
  read: (n) => `${n} file${n === 1 ? '' : 's'} read`,
  listed: (n) => `${n} listed`,
  searched: (n) => `${n} search${n === 1 ? '' : 'es'}`,
  fetched: (n) => `${n} fetch${n === 1 ? '' : 'es'}`,
  edited: (n) => `${n} edit${n === 1 ? '' : 's'}`,
  ran: (n) => `${n} command${n === 1 ? '' : 's'}`,
  other: (n) => `${n} other`,
};

// Categories render in this fixed order regardless of encounter order, so
// the summary line is stable across renders of the same finished group.
const CATEGORY_ORDER = [
  'read',
  'listed',
  'searched',
  'fetched',
  'edited',
  'ran',
  'other',
];

/**
 * Prefix for the synthetic expansion-state key a collapsed tool group uses
 * with `useToolActions().isExpanded`/`toggleExpansion` (which otherwise
 * key off individual tool `callId`s). Shared with `historyUtils.ts` so
 * Ctrl+O ("expand last turn") also expands/collapses group summaries.
 */
export const TOOL_GROUP_EXPANSION_ID_PREFIX = 'group:';

export function toolGroupExpansionId(historyItemId: number): string {
  return `${TOOL_GROUP_EXPANSION_ID_PREFIX}${historyItemId}`;
}

export type ToolGroupOutcome = 'success' | 'error' | 'cancelled';

export interface ToolGroupSummary {
  /** Overall outcome across the group -- error beats cancelled beats success. */
  outcome: ToolGroupOutcome;
  /** e.g. "3 files read, 1 search" -- never empty when tools.length > 0. */
  countsLabel: string;
  /** Sum of every tool's real durationMs, only when ALL tools reported one. */
  totalDurationMs: number | undefined;
  toolCount: number;
}

function isTerminal(status: CoreToolCallStatus): boolean {
  return (
    status === CoreToolCallStatus.Success ||
    status === CoreToolCallStatus.Error ||
    status === CoreToolCallStatus.Cancelled
  );
}

/** True only when every tool in the group has reached a terminal state. */
export function isToolGroupFinished(
  tools: readonly IndividualToolCallDisplay[],
): boolean {
  return tools.length > 0 && tools.every((t) => isTerminal(t.status));
}

/**
 * Summarizes a finished batch of tool calls for the collapsed group view.
 * Pure and duration-honest: `totalDurationMs` is only set when every tool
 * reported a real duration, never estimated or padded.
 */
export function summarizeToolGroup(
  tools: readonly IndividualToolCallDisplay[],
): ToolGroupSummary {
  const counts = new Map<string, number>();
  let hasError = false;
  let hasCancelled = false;
  let totalDurationMs = 0;
  let allHaveDuration = tools.length > 0;

  for (const tool of tools) {
    const category = categorize(tool);
    counts.set(category, (counts.get(category) ?? 0) + 1);

    if (tool.status === CoreToolCallStatus.Error) hasError = true;
    if (tool.status === CoreToolCallStatus.Cancelled) hasCancelled = true;

    if (typeof tool.durationMs === 'number') {
      totalDurationMs += tool.durationMs;
    } else {
      allHaveDuration = false;
    }
  }

  const countsLabel = CATEGORY_ORDER.filter((c) => counts.has(c))
    .map((c) => CATEGORY_LABELS[c](counts.get(c)!))
    .join(', ');

  return {
    outcome: hasError ? 'error' : hasCancelled ? 'cancelled' : 'success',
    countsLabel:
      countsLabel ||
      `${tools.length} tool call${tools.length === 1 ? '' : 's'}`,
    totalDurationMs: allHaveDuration ? totalDurationMs : undefined,
    toolCount: tools.length,
  };
}

/** Formats a duration for display: "850ms", "1.2s", "1m 05s". */
export function formatToolGroupDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

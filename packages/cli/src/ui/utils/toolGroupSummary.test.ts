/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  summarizeToolGroup,
  isToolGroupFinished,
  formatToolGroupDuration,
} from './toolGroupSummary.js';
import { CoreToolCallStatus } from '../types.js';
import type { IndividualToolCallDisplay } from '../types.js';

function tool(
  overrides: Partial<IndividualToolCallDisplay>,
): IndividualToolCallDisplay {
  return {
    callId: 'call-1',
    name: 'read_file',
    description: '',
    resultDisplay: undefined,
    status: CoreToolCallStatus.Success,
    confirmationDetails: undefined,
    ...overrides,
  };
}

describe('isToolGroupFinished', () => {
  it('is false for an empty group', () => {
    expect(isToolGroupFinished([])).toBe(false);
  });

  it('is false when any tool is still executing or awaiting approval', () => {
    expect(
      isToolGroupFinished([
        tool({ status: CoreToolCallStatus.Success }),
        tool({ status: CoreToolCallStatus.Executing }),
      ]),
    ).toBe(false);
    expect(
      isToolGroupFinished([
        tool({ status: CoreToolCallStatus.AwaitingApproval }),
      ]),
    ).toBe(false);
  });

  it('is true when every tool is success/error/cancelled', () => {
    expect(
      isToolGroupFinished([
        tool({ status: CoreToolCallStatus.Success }),
        tool({ status: CoreToolCallStatus.Error }),
        tool({ status: CoreToolCallStatus.Cancelled }),
      ]),
    ).toBe(true);
  });
});

describe('summarizeToolGroup', () => {
  it('categorizes read/list/search/edit/shell tools with correct pluralization', () => {
    const summary = summarizeToolGroup([
      tool({ name: 'ReadFile' }),
      tool({ name: 'ReadFile' }),
      tool({ name: 'FindFiles' }),
      tool({ name: 'SearchText' }),
      tool({ name: 'Edit' }),
      tool({ name: 'Shell' }),
    ]);
    expect(summary.countsLabel).toBe(
      '2 files read, 1 listed, 1 search, 1 edit, 1 command',
    );
    expect(summary.toolCount).toBe(6);
  });

  it('falls back to a generic tool-call count when no category matches', () => {
    const summary = summarizeToolGroup([tool({ name: 'some_mcp_tool' })]);
    expect(summary.countsLabel).toBe('1 other');
  });

  it('reports error outcome if any tool errored, even alongside successes', () => {
    const summary = summarizeToolGroup([
      tool({ status: CoreToolCallStatus.Success }),
      tool({ status: CoreToolCallStatus.Error }),
    ]);
    expect(summary.outcome).toBe('error');
  });

  it('reports cancelled outcome only when nothing errored', () => {
    const summary = summarizeToolGroup([
      tool({ status: CoreToolCallStatus.Success }),
      tool({ status: CoreToolCallStatus.Cancelled }),
    ]);
    expect(summary.outcome).toBe('cancelled');
  });

  it('reports success outcome when everything succeeded', () => {
    const summary = summarizeToolGroup([tool({}), tool({})]);
    expect(summary.outcome).toBe('success');
  });

  it('sums real durations only when every tool reported one', () => {
    const summary = summarizeToolGroup([
      tool({ durationMs: 100 }),
      tool({ durationMs: 250 }),
    ]);
    expect(summary.totalDurationMs).toBe(350);
  });

  it('never fabricates a duration -- omits it if even one tool lacks a real value', () => {
    const summary = summarizeToolGroup([
      tool({ durationMs: 100 }),
      tool({ durationMs: undefined }),
    ]);
    expect(summary.totalDurationMs).toBeUndefined();
  });
});

describe('formatToolGroupDuration', () => {
  it('formats sub-second durations in ms', () => {
    expect(formatToolGroupDuration(850)).toBe('850ms');
  });

  it('formats sub-minute durations with one decimal of seconds', () => {
    expect(formatToolGroupDuration(1234)).toBe('1.2s');
  });

  it('formats minute-plus durations as Xm SSs', () => {
    expect(formatToolGroupDuration(65000)).toBe('1m 05s');
  });
});

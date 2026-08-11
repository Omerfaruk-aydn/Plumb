/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { act } from 'react';
import { SubagentState } from '@google/gemini-cli-core';
import { AgentMissionControl } from './AgentMissionControl.js';
import type { AgentRun } from '../utils/sessionAgentActivity.js';

const DOWN_ARROW = String.fromCharCode(0x1b) + '[B';
const UP_ARROW = String.fromCharCode(0x1b) + '[A';
const ESCAPE = String.fromCharCode(0x1b);

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    key: 'run-1',
    agentName: 'researcher',
    state: SubagentState.RUNNING,
    activity: [
      {
        id: 'a1',
        type: 'thought',
        content: 'Looking at the codebase',
        status: SubagentState.RUNNING,
      },
    ],
    ...overrides,
  };
}

async function pressKey(stdin: { write: (data: string) => void }, key: string) {
  await act(async () => {
    vi.advanceTimersByTime(100);
    stdin.write(key);
  });
}

describe('AgentMissionControl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows an empty state when no agents have run yet', async () => {
    const { lastFrame } = await renderWithProviders(
      <AgentMissionControl runs={[]} onClose={vi.fn()} terminalWidth={100} />,
    );
    expect(lastFrame()).toContain('No agents have run yet');
  });

  it('lists every agent and shows the first agent activity by default', async () => {
    const runs = [
      makeRun({ key: 'run-1', agentName: 'researcher' }),
      makeRun({ key: 'run-2', agentName: 'reviewer' }),
    ];
    const { lastFrame } = await renderWithProviders(
      <AgentMissionControl runs={runs} onClose={vi.fn()} terminalWidth={100} />,
    );
    const frame = lastFrame();
    expect(frame).toContain('researcher');
    expect(frame).toContain('reviewer');
    expect(frame).toContain('Looking at the codebase');
  });

  it('Down arrow moves the agent selection and updates the activity panel', async () => {
    const runs = [
      makeRun({
        key: 'run-1',
        agentName: 'researcher',
        activity: [
          {
            id: 'a1',
            type: 'thought',
            content: 'ALPHA activity',
            status: SubagentState.RUNNING,
          },
        ],
      }),
      makeRun({
        key: 'run-2',
        agentName: 'reviewer',
        state: SubagentState.COMPLETED,
        activity: [
          {
            id: 'b1',
            type: 'tool_call',
            content: 'BETA activity',
            status: SubagentState.COMPLETED,
          },
        ],
      }),
    ];
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <AgentMissionControl runs={runs} onClose={vi.fn()} terminalWidth={100} />,
    );

    await waitUntilReady();
    expect(lastFrame()).toContain('ALPHA activity');

    await pressKey(stdin, DOWN_ARROW);
    await waitUntilReady();

    expect(lastFrame()).toContain('BETA activity');
  });

  it('Up arrow at the top stays on the first agent', async () => {
    const runs = [
      makeRun({
        key: 'run-1',
        agentName: 'researcher',
        activity: [
          {
            id: 'a1',
            type: 'thought',
            content: 'ALPHA activity',
            status: SubagentState.RUNNING,
          },
        ],
      }),
      makeRun({
        key: 'run-2',
        agentName: 'reviewer',
        activity: [
          {
            id: 'b1',
            type: 'tool_call',
            content: 'BETA activity',
            status: SubagentState.COMPLETED,
          },
        ],
      }),
    ];
    const { stdin, lastFrame, waitUntilReady } = await renderWithProviders(
      <AgentMissionControl runs={runs} onClose={vi.fn()} terminalWidth={100} />,
    );

    await waitUntilReady();
    await pressKey(stdin, UP_ARROW);
    await waitUntilReady();

    expect(lastFrame()).toContain('ALPHA activity');
    expect(lastFrame()).not.toContain('BETA activity');
  });

  it('Escape closes the screen', async () => {
    const onClose = vi.fn();
    const { stdin, waitUntilReady } = await renderWithProviders(
      <AgentMissionControl
        runs={[makeRun()]}
        onClose={onClose}
        terminalWidth={100}
      />,
    );

    await waitUntilReady();
    await pressKey(stdin, ESCAPE);
    await waitUntilReady();

    expect(onClose).toHaveBeenCalled();
  });

  it('shows the running agent count in the header', async () => {
    const runs = [
      makeRun({ key: 'run-1', state: SubagentState.RUNNING }),
      makeRun({ key: 'run-2', state: SubagentState.COMPLETED }),
    ];
    const { lastFrame } = await renderWithProviders(
      <AgentMissionControl runs={runs} onClose={vi.fn()} terminalWidth={100} />,
    );
    expect(lastFrame()).toContain('1 running');
  });
});

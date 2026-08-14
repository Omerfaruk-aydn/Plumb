/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { MultiAgentStatus } from './MultiAgentStatus.js';

const defaultAgents = [
  {
    id: 'agent-1',
    name: 'Coder',
    type: 'coder',
    status: 'running' as const,
    currentTask: 'Writing code',
  },
];

describe('<MultiAgentStatus />', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when agents array is empty', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MultiAgentStatus agents={[]} terminalWidth={100} compact={false} />,
    );
    await waitUntilReady();
    const frame = lastFrame({ allowEmpty: true });
    expect(frame.trim()).toBe('');
    unmount();
  });

  it('renders agent name and type', async () => {
    vi.useFakeTimers();
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MultiAgentStatus
        agents={defaultAgents}
        terminalWidth={100}
        compact={false}
      />,
    );
    await waitUntilReady();
    vi.advanceTimersByTime(200);
    const frame = lastFrame();
    expect(frame).toContain('Coder');
    expect(frame).toContain('coder');
    unmount();
    vi.useRealTimers();
  });

  it('displays running status icon', async () => {
    vi.useFakeTimers();
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MultiAgentStatus
        agents={defaultAgents}
        terminalWidth={100}
        compact={false}
      />,
    );
    await waitUntilReady();
    vi.advanceTimersByTime(200);
    const frame = lastFrame();
    expect(frame).toContain('\u25CF');
    unmount();
    vi.useRealTimers();
  });

  it('shows completed status', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MultiAgentStatus
        agents={[
          {
            id: 'agent-1',
            name: 'Done Agent',
            type: 'reviewer',
            status: 'completed',
          },
        ]}
        terminalWidth={100}
        compact={false}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('\u2713');
    expect(frame).toContain('Done Agent');
    unmount();
  });

  it('shows failed status', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MultiAgentStatus
        agents={[
          {
            id: 'agent-1',
            name: 'Failed Agent',
            type: 'tester',
            status: 'failed',
          },
        ]}
        terminalWidth={100}
        compact={false}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('\u2717');
    expect(frame).toContain('Failed Agent');
    unmount();
  });

  it('renders compact mode for narrow terminals', async () => {
    vi.useFakeTimers();
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MultiAgentStatus
        agents={defaultAgents}
        terminalWidth={50}
        compact={false}
      />,
    );
    await waitUntilReady();
    vi.advanceTimersByTime(200);
    const frame = lastFrame();
    expect(frame).toContain('Agents:');
    unmount();
    vi.useRealTimers();
  });

  it('shows current task when present', async () => {
    vi.useFakeTimers();
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MultiAgentStatus
        agents={defaultAgents}
        terminalWidth={100}
        compact={false}
      />,
    );
    await waitUntilReady();
    vi.advanceTimersByTime(200);
    const frame = lastFrame();
    expect(frame).toContain('Writing code');
    unmount();
    vi.useRealTimers();
  });

  it('shows progress bar when progress data available', async () => {
    vi.useFakeTimers();
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MultiAgentStatus
        agents={[
          {
            id: 'agent-1',
            name: 'Progress Agent',
            type: 'coder',
            status: 'running',
            progress: 5,
            progressTotal: 10,
          },
        ]}
        terminalWidth={100}
        compact={false}
      />,
    );
    await waitUntilReady();
    vi.advanceTimersByTime(200);
    const frame = lastFrame();
    expect(frame).toContain('5/10');
    unmount();
    vi.useRealTimers();
  });
});

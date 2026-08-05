/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { AgentProgressLine } from './AgentProgressLine.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('<AgentProgressLine />', () => {
  it('renders agent name and type', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <AgentProgressLine
        agentName="Tool"
        agentType="execution"
        currentStep="read_file"
        isComplete={false}
        compact={false}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Tool');
    expect(frame).toContain('execution');
    unmount();
  });

  it('shows checkmark when complete', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <AgentProgressLine
        agentName="Tool"
        agentType="execution"
        isComplete={true}
        compact={false}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('\u2713');
    unmount();
  });

  it('displays current step', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <AgentProgressLine
        agentName="Tool"
        agentType="execution"
        currentStep="write_file"
        isComplete={false}
        compact={false}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('write_file');
    unmount();
  });

  it('renders compact mode when complete', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <AgentProgressLine
        agentName="Tool"
        agentType="execution"
        compact={true}
        isComplete={true}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Tool');
    unmount();
  });

  it('shows step progress counts', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <AgentProgressLine
        agentName="Tool"
        agentType="execution"
        isComplete={true}
        compact={false}
        steps={[
          { name: 'step1', status: 'completed' },
          { name: 'step2', status: 'completed' },
        ]}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('2/2');
    unmount();
  });

  it('shows failed step with error', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <AgentProgressLine
        agentName="Tool"
        agentType="execution"
        isComplete={true}
        compact={false}
        steps={[
          {
            name: 'deploy',
            status: 'failed',
            error: 'Connection refused',
          },
        ]}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('\u2717');
    expect(frame).toContain('Connection refused');
    unmount();
  });

  it('renders non-compact mode when complete', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <AgentProgressLine
        agentName="Tool"
        agentType="execution"
        isComplete={true}
        compact={false}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Tool');
    expect(frame).toContain('execution');
    expect(frame).toContain('\u2713');
    unmount();
  });
});

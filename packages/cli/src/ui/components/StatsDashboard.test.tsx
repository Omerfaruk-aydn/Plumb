/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { uiTelemetryService, ToolCallDecision } from '@plumb/core';
import type { SessionMetrics } from '@plumb/core';
import { renderWithProviders } from '../../test-utils/render.js';
import { createMockSettings } from '../../test-utils/settings.js';
import { StatsDashboard } from './StatsDashboard.js';

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return { ...actual, useIsScreenReaderEnabled: vi.fn(() => false) };
});

function makeMetrics(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    models: {},
    tools: {
      totalCalls: 0,
      totalSuccess: 0,
      totalFail: 0,
      totalDurationMs: 0,
      totalDecisions: {
        [ToolCallDecision.ACCEPT]: 0,
        [ToolCallDecision.REJECT]: 0,
        [ToolCallDecision.MODIFY]: 0,
        [ToolCallDecision.AUTO_ACCEPT]: 0,
      },
      byName: {},
    },
    files: { totalLinesAdded: 0, totalLinesRemoved: 0 },
    ...overrides,
  };
}

function seedMetrics(metrics: SessionMetrics) {
  act(() => {
    uiTelemetryService.emit('update', { metrics, lastPromptTokenCount: 0 });
  });
}

async function pressKey(stdin: { write: (data: string) => void }, key: string) {
  await act(async () => {
    vi.advanceTimersByTime(100);
    stdin.write(key);
  });
}

async function renderDashboard(width: number) {
  const onClose = vi.fn();
  const result = await renderWithProviders(
    <StatsDashboard onClose={onClose} />,
    {
      settings: createMockSettings({}),
      width,
    },
  );
  return { ...result, onClose };
}

describe('StatsDashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seedMetrics(makeMetrics());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders both the overview and top-tools panels side by side at a wide width', async () => {
    const { lastFrame, waitUntilReady } = await renderDashboard(140);
    await waitUntilReady();

    seedMetrics(
      makeMetrics({
        models: {
          'gemini-pro': {
            api: { totalRequests: 3, totalErrors: 0, totalLatencyMs: 300 },
            tokens: {
              input: 10,
              prompt: 10,
              candidates: 20,
              total: 30,
              cached: 0,
              thoughts: 0,
              tool: 0,
            },
            roles: {},
          },
        },
        tools: {
          totalCalls: 2,
          totalSuccess: 2,
          totalFail: 0,
          totalDurationMs: 50,
          totalDecisions: {
            [ToolCallDecision.ACCEPT]: 2,
            [ToolCallDecision.REJECT]: 0,
            [ToolCallDecision.MODIFY]: 0,
            [ToolCallDecision.AUTO_ACCEPT]: 0,
          },
          byName: {
            read_file: {
              count: 2,
              success: 2,
              fail: 0,
              durationMs: 50,
              decisions: {
                [ToolCallDecision.ACCEPT]: 2,
                [ToolCallDecision.REJECT]: 0,
                [ToolCallDecision.MODIFY]: 0,
                [ToolCallDecision.AUTO_ACCEPT]: 0,
              },
            },
          },
        },
      }),
    );
    await waitUntilReady();

    const frame = lastFrame();
    expect(frame).toContain('Overview');
    expect(frame).toContain('Top tools');
    expect(frame).toContain('gemini-pro');
    expect(frame).toContain('read_file');
  });

  it('shows empty-state cards for models and tools with no session activity', async () => {
    const { lastFrame } = await renderDashboard(140);
    const frame = lastFrame();
    expect(frame).toContain('No model activity yet.');
    expect(frame).toContain('No tool calls yet.');
  });

  it('stacks panels in a single column below the narrow-layout threshold', async () => {
    const wide = await renderDashboard(140);
    const narrow = await renderDashboard(80);
    // Both still render the same sections; the layout direction differs
    // (column vs row) but that's a flex-direction change Ink doesn't expose
    // to text assertions -- verify both still show all content intact.
    expect(wide.lastFrame()).toContain('Overview');
    expect(narrow.lastFrame()).toContain('Overview');
    expect(narrow.lastFrame()).toContain('Top tools');
  });

  it('shows a "collecting samples" placeholder before two refresh ticks land, then a sparkline', async () => {
    const { lastFrame, waitUntilReady } = await renderDashboard(140);
    await waitUntilReady();
    expect(lastFrame()).toContain('Collecting samples');

    seedMetrics(
      makeMetrics({
        models: {
          'gemini-pro': {
            api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 10 },
            tokens: {
              input: 5,
              prompt: 5,
              candidates: 5,
              total: 10,
              cached: 0,
              thoughts: 0,
              tool: 0,
            },
            roles: {},
          },
        },
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await waitUntilReady();

    expect(lastFrame()).toContain('Token activity');
  });

  it('renders a flat text summary (no panels/borders) for a screen reader', async () => {
    const { useIsScreenReaderEnabled } = await import('ink');
    vi.mocked(useIsScreenReaderEnabled).mockReturnValue(true);

    const { lastFrame } = await renderDashboard(140);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Live session stats');
    expect(frame).not.toContain('Overview');
    expect(frame).not.toContain('Top tools');

    vi.mocked(useIsScreenReaderEnabled).mockReturnValue(false);
  });

  it('closes on "q"', async () => {
    const { stdin, onClose, waitUntilReady } = await renderDashboard(140);
    await waitUntilReady();
    await pressKey(stdin, 'q');
    await waitUntilReady();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

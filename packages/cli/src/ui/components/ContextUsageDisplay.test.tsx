/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders } from '../../test-utils/render.js';
import { ContextUsageDisplay } from './ContextUsageDisplay.js';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@plumb/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plumb/core')>();
  return {
    ...actual,
    tokenLimit: () => 10000,
    // "opus" simulates a Claude Subscription generic alias with a
    // confirmed-UNKNOWN real context window; every other model id keeps
    // the actual (known) behavior.
    hasKnownTokenLimit: (model: string) => model !== 'opus',
  };
});

describe('ContextUsageDisplay', () => {
  it('renders correct percentage used', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={5000}
        model="gemini-pro"
        terminalWidth={120}
      />,
    );
    const output = lastFrame();
    expect(output).toContain('50% used');
    unmount();
  });

  it('renders correctly when usage is 0%', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={0}
        model="gemini-pro"
        terminalWidth={120}
      />,
    );
    const output = lastFrame();
    expect(output).toContain('0% used');
    unmount();
  });

  it('renders abbreviated label when terminal width is small', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={2000}
        model="gemini-pro"
        terminalWidth={80}
      />,
      { width: 80 },
    );
    const output = lastFrame();
    expect(output).toContain('20%');
    expect(output).not.toContain('context used');
    unmount();
  });

  it('renders 80% correctly', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={8000}
        model="gemini-pro"
        terminalWidth={120}
      />,
    );
    const output = lastFrame();
    expect(output).toContain('80% used');
    unmount();
  });

  it('renders 100% when full', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={10000}
        model="gemini-pro"
        terminalWidth={120}
      />,
    );
    const output = lastFrame();
    expect(output).toContain('100% used');
    unmount();
  });

  it('renders an honest unknown state, never a percentage against the internal safety-budget fallback', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={5000}
        model="opus"
        terminalWidth={120}
      />,
    );
    const output = lastFrame();
    expect(output).toContain('?');
    expect(output).not.toContain('50% used');
    expect(output).not.toMatch(/\d+%/);
    unmount();
  });
});

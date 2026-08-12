/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * GradientStreamCursor drives a real setInterval via useColorCycle (see
 * that component's own doc comment). Empirically, rendering a live
 * interval-driven component directly under vi.useFakeTimers() hangs this
 * test harness's own waitUntilReady loop -- Ink's async render
 * scheduling and the fake-timer-driven interval end up fighting each
 * other. GeminiSpinner (the other useColorCycle consumer) avoids this by
 * having zero dedicated test files -- it's always mocked away wherever
 * it's rendered. This file does the same: mock useColorCycle itself so
 * only the component's own conditional logic (screen reader branch) is
 * under test, not the live animation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { GradientStreamCursor } from './GradientStreamCursor.js';
import { useIsScreenReaderEnabled } from 'ink';

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useIsScreenReaderEnabled: vi.fn(),
  };
});

vi.mock('../hooks/useColorCycle.js', () => ({
  useColorCycle: vi.fn(() => '#ff00ff'),
}));

describe('GradientStreamCursor', () => {
  const mockUseIsScreenReaderEnabled = vi.mocked(useIsScreenReaderEnabled);

  beforeEach(() => {
    mockUseIsScreenReaderEnabled.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a cursor character', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <GradientStreamCursor />,
    );
    expect(lastFrame()).toContain('▌');
    unmount();
  });

  it('renders nothing for screen readers (no meaningful text content)', async () => {
    mockUseIsScreenReaderEnabled.mockReturnValue(true);
    const { lastFrame, unmount } = await renderWithProviders(
      <GradientStreamCursor />,
    );
    expect(lastFrame({ allowEmpty: true })).toBe('');
    unmount();
  });
});

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
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

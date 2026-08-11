/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '../../test-utils/render.js';
import { GradientStreamCursor } from './GradientStreamCursor.js';
import { useIsScreenReaderEnabled } from 'ink';

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useIsScreenReaderEnabled: vi.fn(),
  };
});

describe('GradientStreamCursor', () => {
  const mockUseIsScreenReaderEnabled = vi.mocked(useIsScreenReaderEnabled);

  beforeEach(() => {
    mockUseIsScreenReaderEnabled.mockReturnValue(false);
  });

  it('renders a cursor character', async () => {
    const { lastFrame, unmount } = await render(<GradientStreamCursor />);
    expect(lastFrame()).toContain('▌');
    unmount();
  });

  it('renders nothing for screen readers (no meaningful text content)', async () => {
    mockUseIsScreenReaderEnabled.mockReturnValue(true);
    const { lastFrame, unmount } = await render(<GradientStreamCursor />);
    expect(lastFrame({ allowEmpty: true })).toBe('');
    unmount();
  });
});

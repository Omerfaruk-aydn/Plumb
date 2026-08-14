/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Text } from 'ink';
import { renderWithProviders } from '../../test-utils/render.js';
import { createMockSettings } from '../../test-utils/settings.js';
import { useCursorStyle } from './useCursorStyle.js';

const setCursorStyleMock = vi.fn();
const resetCursorStyleMock = vi.fn();

vi.mock('@plumb/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plumb/core')>();
  return {
    ...actual,
    setCursorStyle: (...args: unknown[]) => setCursorStyleMock(...args),
    resetCursorStyle: (...args: unknown[]) => resetCursorStyleMock(...args),
  };
});

function Host() {
  useCursorStyle();
  return <Text>host</Text>;
}

describe('useCursorStyle', () => {
  beforeEach(() => {
    setCursorStyleMock.mockReset();
    resetCursorStyleMock.mockReset();
  });

  it('emits the configured DECSCUSR code on mount', async () => {
    const settings = createMockSettings({
      ui: { cursor: { style: 'underline', blinking: false } },
    });
    const { unmount } = await renderWithProviders(<Host />, { settings });

    expect(setCursorStyleMock).toHaveBeenCalledWith(4);
    unmount();
  });

  it('restores the terminal cursor (code 0) on unmount', async () => {
    const settings = createMockSettings({
      ui: { cursor: { style: 'block', blinking: true } },
    });
    const { unmount } = await renderWithProviders(<Host />, { settings });

    expect(resetCursorStyleMock).not.toHaveBeenCalled();
    unmount();
    expect(resetCursorStyleMock).toHaveBeenCalledTimes(1);
  });

  it('defaults to a no-op reset code when no cursor setting is configured (default regression)', async () => {
    const settings = createMockSettings({});
    const { unmount } = await renderWithProviders(<Host />, { settings });

    expect(setCursorStyleMock).toHaveBeenCalledWith(0);
    unmount();
  });
});

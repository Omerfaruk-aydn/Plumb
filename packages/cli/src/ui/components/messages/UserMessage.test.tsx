/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders } from '../../../test-utils/render.js';
import { UserMessage } from './UserMessage.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeFakeConfig } from '@plumb/core';

// Mock the commandUtils to control isSlashCommand behavior
vi.mock('../../utils/commandUtils.js', () => ({
  isSlashCommand: vi.fn((text: string) => text.startsWith('/')),
}));

describe('UserMessage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('renders normal user message with correct prefix', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <UserMessage text="Hello Gemini" width={80} />,
      { width: 80 },
    );
    const output = lastFrame();

    expect(output).toMatchSnapshot();
    unmount();
  });

  it('renders slash command message', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <UserMessage text="/help" width={80} />,
      { width: 80 },
    );
    const output = lastFrame();

    expect(output).toMatchSnapshot();
    unmount();
  });

  it('renders multiline user message', async () => {
    const message = 'Line 1\nLine 2';
    const { lastFrame, unmount } = await renderWithProviders(
      <UserMessage text={message} width={80} />,
      { width: 80 },
    );
    const output = lastFrame();

    expect(output).toMatchSnapshot();
    unmount();
  });

  it('transforms image paths in user message', async () => {
    const message = 'Check out this image: @/path/to/my-image.png';
    const { lastFrame, unmount } = await renderWithProviders(
      <UserMessage text={message} width={80} />,
      { width: 80 },
    );
    const output = lastFrame();

    expect(output).toContain('[Image my-image.png]');
    expect(output).toMatchSnapshot();
    unmount();
  });

  describe('with NO_COLOR set', () => {
    beforeEach(() => {
      vi.stubEnv('NO_COLOR', '1');
    });

    it('renders the left rule in plain monochrome (no color-block hack) when NO_COLOR is set', async () => {
      const { lastFrame, unmount } = await renderWithProviders(
        <UserMessage text="Hello Gemini" width={80} />,
        { width: 80, config: makeFakeConfig({ useBackgroundColor: true }) },
      );
      const output = lastFrame();

      // In NO_COLOR mode, the block characters (▄/▀) from the old
      // half-line-background hack should NOT be present -- the left rule
      // is a plain structural glyph, not a color effect, so it still
      // renders while the surface tint drops out.
      expect(output).not.toContain('▄');
      expect(output).not.toContain('▀');

      const lines = output.split('\n').filter((l) => l.trim() !== '');
      expect(lines.some((l) => l.includes('❯ Hello Gemini'))).toBe(true);

      expect(output).toMatchSnapshot();

      unmount();
    });
  });
});

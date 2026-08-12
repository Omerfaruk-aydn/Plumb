/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { InlineImage } from './InlineImage.js';
import {
  encodeKittyImage,
  encodeITerm2Image,
} from '../utils/terminalImageProtocol.js';

describe('InlineImage', () => {
  it('shows a fallback with the reason when disabled by settings', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <InlineImage
        mimeType="image/png"
        data="AAAA"
        toolName="screenshot"
        enabled={false}
        protocolOverride="kitty"
      />,
    );
    expect(lastFrame()).toContain('image/png');
    expect(lastFrame()).toContain('screenshot');
    expect(lastFrame()).toContain('enable ui.enableInlineImages');
    unmount();
  });

  it('shows a fallback with an "unsupported terminal" reason when enabled but no protocol is detected', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <InlineImage
        mimeType="image/png"
        data="AAAA"
        toolName="screenshot"
        enabled={true}
        protocolOverride="none"
      />,
    );
    expect(lastFrame()).toContain('unsupported terminal');
    unmount();
  });

  it('shows a fallback for an unsupported mime type even with a supported terminal', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <InlineImage
        mimeType="image/svg+xml"
        data="AAAA"
        toolName="diagram"
        enabled={true}
        protocolOverride="kitty"
      />,
    );
    expect(lastFrame()).toContain('image/svg+xml');
    unmount();
  });

  it('writes a Kitty-encoded sequence exactly once when enabled with a supported protocol', async () => {
    const writeOverride = vi.fn();
    const { lastFrame, unmount } = await renderWithProviders(
      <InlineImage
        mimeType="image/png"
        data="AAAA"
        toolName="screenshot"
        enabled={true}
        protocolOverride="kitty"
        writeOverride={writeOverride}
      />,
    );
    expect(lastFrame({ allowEmpty: true })).not.toContain('image/png');
    expect(writeOverride).toHaveBeenCalledTimes(1);
    expect(writeOverride).toHaveBeenCalledWith(encodeKittyImage('AAAA'));
    unmount();
  });

  it('writes an iTerm2-encoded sequence when that protocol is detected', async () => {
    const writeOverride = vi.fn();
    const { unmount } = await renderWithProviders(
      <InlineImage
        mimeType="image/jpeg"
        data="AAAA"
        toolName="screenshot"
        enabled={true}
        protocolOverride="iterm2"
        writeOverride={writeOverride}
      />,
    );
    expect(writeOverride).toHaveBeenCalledWith(
      encodeITerm2Image('AAAA', {
        sizeBytes: Buffer.byteLength('AAAA', 'base64'),
        name: 'screenshot',
      }),
    );
    unmount();
  });

  it('does not re-write on a re-render of the same image', async () => {
    const writeOverride = vi.fn();
    const { rerender, unmount } = await renderWithProviders(
      <InlineImage
        mimeType="image/png"
        data="AAAA"
        toolName="screenshot"
        enabled={true}
        protocolOverride="kitty"
        writeOverride={writeOverride}
      />,
    );
    expect(writeOverride).toHaveBeenCalledTimes(1);

    rerender(
      <InlineImage
        mimeType="image/png"
        data="AAAA"
        toolName="screenshot"
        enabled={true}
        protocolOverride="kitty"
        writeOverride={writeOverride}
      />,
    );
    expect(writeOverride).toHaveBeenCalledTimes(1);
    unmount();
  });
});

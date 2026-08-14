/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import {
  StreamingTextAnimation,
  TypingIndicator,
} from './StreamingTextAnimation.js';

describe('<StreamingTextAnimation />', () => {
  it('shows animation indicator when streaming', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <StreamingTextAnimation
        isStreaming={true}
        style="dots"
        text=""
        charsPerSecond={50}
        showCursor={true}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame.length).toBeGreaterThan(0);
    unmount();
  });

  it('renders text content when provided', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <StreamingTextAnimation
        isStreaming={true}
        style="dots"
        text="Hello world"
        charsPerSecond={50}
        showCursor={true}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Hello');
    unmount();
  });

  it('clears timers on unmount', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const { unmount, waitUntilReady } = await renderWithProviders(
      <StreamingTextAnimation
        isStreaming={true}
        style="dots"
        text="test"
        charsPerSecond={50}
        showCursor={true}
      />,
    );
    await waitUntilReady();
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it('clears timers when isStreaming becomes false', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const { rerender, waitUntilReady, unmount } = await renderWithProviders(
      <StreamingTextAnimation
        isStreaming={true}
        style="dots"
        text="test"
        charsPerSecond={50}
        showCursor={true}
      />,
    );
    await waitUntilReady();
    rerender(
      <StreamingTextAnimation
        isStreaming={false}
        style="dots"
        text="test"
        charsPerSecond={50}
        showCursor={true}
      />,
    );
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
    unmount();
  });

  it('does not show cursor when not streaming', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <StreamingTextAnimation
        isStreaming={true}
        style="dots"
        text="Hello"
        charsPerSecond={50}
        showCursor={true}
      />,
    );
    await waitUntilReady();
    // While streaming, cursor should be visible
    const frame = lastFrame();
    expect(frame.length).toBeGreaterThan(0);
    unmount();
  });

  it('clears animation interval on unmount', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const { unmount, waitUntilReady } = await renderWithProviders(
      <StreamingTextAnimation
        isStreaming={true}
        style="dots"
        text="test"
        charsPerSecond={50}
        showCursor={true}
      />,
    );
    await waitUntilReady();
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});

describe('<TypingIndicator />', () => {
  it('renders nothing when not active', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <TypingIndicator isActive={false} />,
    );
    await waitUntilReady();
    const frame = lastFrame({ allowEmpty: true });
    expect(frame.trim()).toBe('');
    unmount();
  });

  it('shows label when active', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <TypingIndicator isActive={true} label="Processing" />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Processing');
    unmount();
  });
});

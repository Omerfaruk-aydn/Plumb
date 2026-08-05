/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { VoiceModeIndicator } from './VoiceModeIndicator.js';

describe('<VoiceModeIndicator />', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows idle state with Voice Ready', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <VoiceModeIndicator
        state="idle"
        isMuted={false}
        volume={0}
        compact={false}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Voice Ready');
    unmount();
  });

  it('shows processing state', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <VoiceModeIndicator
        state="processing"
        isMuted={false}
        volume={0}
        compact={false}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Processing');
    unmount();
  });

  it('shows error state', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <VoiceModeIndicator
        state="error"
        isMuted={false}
        volume={0}
        compact={false}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Voice Error');
    expect(frame).toContain('microphone permissions');
    unmount();
  });

  it('shows muted indicator', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <VoiceModeIndicator
        state="idle"
        isMuted={true}
        volume={0}
        compact={false}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('muted');
    unmount();
  });

  it('shows transcript when provided', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <VoiceModeIndicator
        state="idle"
        isMuted={false}
        volume={0}
        transcript="Hello world"
        compact={false}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Hello world');
    unmount();
  });

  it('renders compact mode', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <VoiceModeIndicator
        state="idle"
        isMuted={false}
        volume={0}
        compact={true}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Voice Ready');
    unmount();
  });

  it('hides volume bar when idle', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <VoiceModeIndicator
        state="idle"
        isMuted={false}
        volume={0.75}
        compact={false}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    // Volume bar only shows when state is 'listening'
    expect(frame).not.toContain('75%');
    unmount();
  });

  it('shows speaking state', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <VoiceModeIndicator
        state="speaking"
        isMuted={false}
        volume={0}
        compact={false}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Speaking');
    unmount();
  });
});

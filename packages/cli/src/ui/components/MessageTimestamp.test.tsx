/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { Text } from 'ink';
import { MessageTimestamp, MessageWithTimestamp } from './MessageTimestamp.js';

describe('<MessageTimestamp />', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders time in HH:MM format', async () => {
    vi.useFakeTimers();
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MessageTimestamp
        timestamp={new Date('2026-01-15T14:30:00')}
        format="time"
        showIcon={true}
        dimColor={true}
      />,
    );
    await waitUntilReady();
    vi.advanceTimersByTime(200);
    const frame = lastFrame();
    expect(frame).toContain('14:30');
    unmount();
    vi.useRealTimers();
  });

  it('renders datetime format', async () => {
    vi.useFakeTimers();
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MessageTimestamp
        timestamp={new Date('2026-01-15T14:30:00')}
        format="datetime"
        showIcon={true}
        dimColor={true}
      />,
    );
    await waitUntilReady();
    vi.advanceTimersByTime(200);
    const frame = lastFrame();
    expect(frame).toContain('Jan');
    expect(frame).toContain('14:30');
    unmount();
    vi.useRealTimers();
  });

  it('returns null for invalid date', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MessageTimestamp
        timestamp={'invalid-date' as unknown as Date}
        format="time"
        showIcon={true}
        dimColor={true}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame({ allowEmpty: true });
    expect(frame.trim()).toBe('');
    unmount();
  });

  it('accepts string timestamp', async () => {
    vi.useFakeTimers();
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MessageTimestamp
        timestamp="2026-06-20T09:15:00"
        format="time"
        showIcon={true}
        dimColor={true}
      />,
    );
    await waitUntilReady();
    vi.advanceTimersByTime(200);
    const frame = lastFrame();
    expect(frame).toContain('09:15');
    unmount();
    vi.useRealTimers();
  });

  it('uses real createdAt from history item', async () => {
    const realTimestamp = new Date('2026-03-15T08:45:00');
    vi.useFakeTimers();
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MessageTimestamp
        timestamp={realTimestamp}
        format="time"
        showIcon={true}
        dimColor={true}
      />,
    );
    await waitUntilReady();
    vi.advanceTimersByTime(200);
    const frame = lastFrame();
    // Should show the real timestamp, not current time
    expect(frame).toContain('08:45');
    unmount();
    vi.useRealTimers();
  });
});

describe('<MessageWithTimestamp />', () => {
  it('renders children with timestamp', async () => {
    vi.useFakeTimers();
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MessageWithTimestamp
        timestamp={new Date('2026-01-15T14:30:00')}
        showTimestamp={true}
        position="right"
      >
        <Text>Hello</Text>
      </MessageWithTimestamp>,
    );
    await waitUntilReady();
    vi.advanceTimersByTime(200);
    const frame = lastFrame();
    expect(frame).toContain('14:30');
    unmount();
    vi.useRealTimers();
  });

  it('renders children without timestamp when showTimestamp is false', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MessageWithTimestamp
        timestamp={new Date('2026-01-15T14:30:00')}
        showTimestamp={false}
      >
        <Text>Hello</Text>
      </MessageWithTimestamp>,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Hello');
    unmount();
  });

  it('renders children without timestamp when no timestamp provided', async () => {
    const { lastFrame, waitUntilReady, unmount } = await renderWithProviders(
      <MessageWithTimestamp showTimestamp={true}>
        <Text>Hello</Text>
      </MessageWithTimestamp>,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Hello');
    unmount();
  });
});

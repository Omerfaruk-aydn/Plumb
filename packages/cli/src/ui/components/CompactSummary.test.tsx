/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { CompactSummary } from './CompactSummary.js';

describe('<CompactSummary />', () => {
  it('renders compaction header', async () => {
    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <CompactSummary
        originalMessageCount={20}
        compactedMessageCount={12}
        tokensSaved={8500}
        summary="Compacted 20 messages to 12"
        terminalWidth={80}
        timestamp="2026-01-15 14:30"
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Context Compacted');
  });

  it('displays message count reduction', async () => {
    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <CompactSummary
        originalMessageCount={20}
        compactedMessageCount={12}
        tokensSaved={8500}
        summary="Compacted 20 messages to 12"
        terminalWidth={80}
        timestamp="2026-01-15 14:30"
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('20');
    expect(frame).toContain('12');
    expect(frame).toContain('8 removed');
  });

  it('displays tokens saved with K formatting', async () => {
    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <CompactSummary
        originalMessageCount={20}
        compactedMessageCount={12}
        tokensSaved={8500}
        summary="test"
        terminalWidth={80}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('8.5K');
  });

  it('displays summary text', async () => {
    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <CompactSummary
        originalMessageCount={20}
        compactedMessageCount={12}
        tokensSaved={8500}
        summary="Compacted 20 messages to 12"
        terminalWidth={80}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Summary:');
    expect(frame).toContain('Compacted 20 messages to 12');
  });

  it('displays timestamp when provided', async () => {
    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <CompactSummary
        originalMessageCount={20}
        compactedMessageCount={12}
        tokensSaved={8500}
        summary="test"
        terminalWidth={80}
        timestamp="2026-01-15 14:30"
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('2026-01-15 14:30');
  });

  it('formats large token counts with M suffix', async () => {
    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <CompactSummary
        originalMessageCount={100}
        compactedMessageCount={50}
        tokensSaved={2500000}
        summary="test"
        terminalWidth={80}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('2.5M');
  });

  it('adapts to narrow terminals', async () => {
    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <CompactSummary
        originalMessageCount={20}
        compactedMessageCount={12}
        tokensSaved={8500}
        summary="test"
        terminalWidth={50}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Msgs:');
  });

  it('shows full labels on wide terminals', async () => {
    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <CompactSummary
        originalMessageCount={20}
        compactedMessageCount={12}
        tokensSaved={8500}
        summary="test"
        terminalWidth={120}
      />,
    );
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Messages:');
    expect(frame).toContain('Tokens saved:');
  });
});

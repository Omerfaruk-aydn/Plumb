/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { ContextVisualization } from './ContextVisualization.js';

const renderContext = async (
  overrides: Partial<React.ComponentProps<typeof ContextVisualization>> = {},
) =>
  renderWithProviders(
    <ContextVisualization
      usedTokens={50000}
      maxTokens={128000}
      modelName="gemini-pro"
      terminalWidth={100}
      showDetails={true}
      {...overrides}
    />,
  );

describe('<ContextVisualization />', () => {
  it('renders progress bar with percentage', async () => {
    const { lastFrame, waitUntilReady } = await renderContext();
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Prompt tokens');
    expect(frame).toContain('39.1%');
  });

  it('renders token counts when showDetails is true', async () => {
    const { lastFrame, waitUntilReady } = await renderContext({
      usedTokens: 50000,
      maxTokens: 128000,
      showDetails: true,
    });
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('50.0K');
    expect(frame).toContain('128.0K');
    expect(frame).toContain('remaining');
  });

  it('shows warning when usage is above 70%', async () => {
    const { lastFrame, waitUntilReady } = await renderContext({
      usedTokens: 100000,
      maxTokens: 128000,
    });
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('getting high');
  });

  it('shows critical warning when usage is above 90%', async () => {
    const { lastFrame, waitUntilReady } = await renderContext({
      usedTokens: 120000,
      maxTokens: 128000,
    });
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('almost full');
    expect(frame).toContain('/compact');
  });

  it('handles zero maxTokens safely', async () => {
    const { lastFrame, waitUntilReady } = await renderContext({
      usedTokens: 0,
      maxTokens: 0,
    });
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('0.0%');
  });

  it('hides details when showDetails is false', async () => {
    const { lastFrame, waitUntilReady } = await renderContext({
      showDetails: false,
    });
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('Prompt tokens');
    expect(frame).not.toContain('remaining');
  });

  it('displays model name when provided', async () => {
    const { lastFrame, waitUntilReady } = await renderContext({
      modelName: 'gemini-3',
    });
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('gemini-3');
  });

  it('formats large token counts with M suffix', async () => {
    const { lastFrame, waitUntilReady } = await renderContext({
      usedTokens: 2500000,
      maxTokens: 4000000,
    });
    await waitUntilReady();
    const frame = lastFrame();
    expect(frame).toContain('2.5M');
    expect(frame).toContain('4.0M');
  });
});

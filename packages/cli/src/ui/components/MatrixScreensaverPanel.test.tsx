/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { MatrixScreensaverPanel } from './MatrixScreensaverPanel.js';

describe('MatrixScreensaverPanel', () => {
  it('renders a dismiss hint', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <MatrixScreensaverPanel terminalWidth={40} seed={1} />,
    );
    expect(lastFrame()).toContain('press any key to continue');
    unmount();
  });

  it('renders the same pattern for the same seed (deterministic)', async () => {
    const { lastFrame: frameA, unmount: unmountA } = await renderWithProviders(
      <MatrixScreensaverPanel terminalWidth={40} seed={42} />,
    );
    const a = frameA();
    unmountA();

    const { lastFrame: frameB, unmount: unmountB } = await renderWithProviders(
      <MatrixScreensaverPanel terminalWidth={40} seed={42} />,
    );
    const b = frameB();
    unmountB();

    expect(a).toBe(b);
  });

  it('renders a different pattern for a different seed', async () => {
    const { lastFrame: frameA, unmount: unmountA } = await renderWithProviders(
      <MatrixScreensaverPanel terminalWidth={40} seed={1} />,
    );
    const a = frameA();
    unmountA();

    const { lastFrame: frameB, unmount: unmountB } = await renderWithProviders(
      <MatrixScreensaverPanel terminalWidth={40} seed={2} />,
    );
    const b = frameB();
    unmountB();

    expect(a).not.toBe(b);
  });

  it('respects a custom row count', async () => {
    const { lastFrame: frameFew, unmount: unmountFew } =
      await renderWithProviders(
        <MatrixScreensaverPanel terminalWidth={40} seed={1} rows={2} />,
      );
    const fewLineCount = frameFew()?.split('\n').length ?? 0;
    unmountFew();

    const { lastFrame: frameMany, unmount: unmountMany } =
      await renderWithProviders(
        <MatrixScreensaverPanel terminalWidth={40} seed={1} rows={10} />,
      );
    const manyLineCount = frameMany()?.split('\n').length ?? 0;
    unmountMany();

    expect(manyLineCount).toBeGreaterThan(fewLineCount);
  });
});

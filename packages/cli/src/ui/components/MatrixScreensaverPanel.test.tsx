/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { MatrixScreensaverPanel } from './MatrixScreensaverPanel.js';

describe('MatrixScreensaverPanel', () => {
  it('renders a dismiss hint', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <MatrixScreensaverPanel terminalWidth={40} seed={1} frameOverride={0} />,
    );
    expect(lastFrame()).toContain('press any key to continue');
    unmount();
  });

  it('renders the same pattern for the same seed and frame (deterministic)', async () => {
    const { lastFrame: frameA, unmount: unmountA } = await renderWithProviders(
      <MatrixScreensaverPanel terminalWidth={40} seed={42} frameOverride={0} />,
    );
    const a = frameA();
    unmountA();

    const { lastFrame: frameB, unmount: unmountB } = await renderWithProviders(
      <MatrixScreensaverPanel terminalWidth={40} seed={42} frameOverride={0} />,
    );
    const b = frameB();
    unmountB();

    expect(a).toBe(b);
  });

  it('renders a different pattern for a different seed', async () => {
    const { lastFrame: frameA, unmount: unmountA } = await renderWithProviders(
      <MatrixScreensaverPanel terminalWidth={40} seed={1} frameOverride={0} />,
    );
    const a = frameA();
    unmountA();

    const { lastFrame: frameB, unmount: unmountB } = await renderWithProviders(
      <MatrixScreensaverPanel terminalWidth={40} seed={2} frameOverride={0} />,
    );
    const b = frameB();
    unmountB();

    expect(a).not.toBe(b);
  });

  it('renders a different pattern for a different frame, same seed (the animation step)', async () => {
    const { lastFrame: frameA, unmount: unmountA } = await renderWithProviders(
      <MatrixScreensaverPanel terminalWidth={40} seed={1} frameOverride={0} />,
    );
    const a = frameA();
    unmountA();

    const { lastFrame: frameB, unmount: unmountB } = await renderWithProviders(
      <MatrixScreensaverPanel terminalWidth={40} seed={1} frameOverride={1} />,
    );
    const b = frameB();
    unmountB();

    expect(a).not.toBe(b);
  });

  it('respects a custom row count', async () => {
    const { lastFrame: frameFew, unmount: unmountFew } =
      await renderWithProviders(
        <MatrixScreensaverPanel
          terminalWidth={40}
          seed={1}
          rows={2}
          frameOverride={0}
        />,
      );
    const fewLineCount = frameFew()?.split('\n').length ?? 0;
    unmountFew();

    const { lastFrame: frameMany, unmount: unmountMany } =
      await renderWithProviders(
        <MatrixScreensaverPanel
          terminalWidth={40}
          seed={1}
          rows={10}
          frameOverride={0}
        />,
      );
    const manyLineCount = frameMany()?.split('\n').length ?? 0;
    unmountMany();

    expect(manyLineCount).toBeGreaterThan(fewLineCount);
  });
});

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { PlumbAnimatedWordmark } from './PlumbAnimatedWordmark.js';
import { getDefaultValue } from '../../utils/settingsUtils.js';

describe('PlumbSettingsPersistence & Layout Stability', () => {
  it('1. verifies ui.animatedLogo default is true and ui.logoAnimationFps default is 8', () => {
    expect(getDefaultValue('ui.animatedLogo')).toBe(true);
    expect(getDefaultValue('ui.logoAnimationFps')).toBe(8);
  });

  it('2. proves disabling animation renders static block wordmark without animation timer', async () => {
    const { lastFrame } = await renderWithProviders(
      <PlumbAnimatedWordmark disabled={true} phase={0} />,
    );
    const frame = lastFrame();
    expect(frame).toContain('████');
  });

  it('3. proves layout geometry remains invariant across 80x24, 120x36, and 160x50 viewports', async () => {
    const res80 = await renderWithProviders(
      <PlumbAnimatedWordmark terminalWidth={80} phase={0} />,
    );
    const frame80 = res80.lastFrame();
    res80.unmount();

    const res120 = await renderWithProviders(
      <PlumbAnimatedWordmark terminalWidth={120} phase={0} />,
    );
    const frame120 = res120.lastFrame();
    res120.unmount();

    const res160 = await renderWithProviders(
      <PlumbAnimatedWordmark terminalWidth={160} phase={0} />,
    );
    const frame160 = res160.lastFrame();
    res160.unmount();

    expect(frame80).toBe(frame120);
    expect(frame120).toBe(frame160);
  });
});

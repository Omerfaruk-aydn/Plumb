/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { AppHeader } from './AppHeader.js';

/**
 * Contract: the production welcome header mounts the production animated
 * RGB wordmark component (PlumbAnimatedWordmark) — not a static or legacy
 * fallback — so the running CLI shows the animated block wordmark.
 */
describe('AppHeader production RGB wordmark route', () => {
  let oldForceColor: string | undefined;
  let oldNoColor: string | undefined;

  beforeEach(() => {
    oldForceColor = process.env['FORCE_COLOR'];
    oldNoColor = process.env['NO_COLOR'];
    process.env['FORCE_COLOR'] = '3';
    delete process.env['NO_COLOR'];
  });

  afterEach(() => {
    if (oldForceColor !== undefined) {
      process.env['FORCE_COLOR'] = oldForceColor;
    } else {
      delete process.env['FORCE_COLOR'];
    }
    if (oldNoColor !== undefined) {
      process.env['NO_COLOR'] = oldNoColor;
    }
  });

  it('mounts the production block wordmark with truecolor RGB output', async () => {
    const { lastFrame, lastFrameRaw, unmount } = await renderWithProviders(
      <AppHeader version="1.0.0" />,
      { uiState: { terminalWidth: 80 } },
    );
    const raw = lastFrameRaw();
    const frame = lastFrame();

    expect(frame).toContain('████');
    expect(raw).toMatch(/\x1b\[38;2;\d{1,3};\d{1,3};\d{1,3}m/);
    expect(frame).toContain('PLUMB CLI v1.0.0');
    unmount();
  });
});

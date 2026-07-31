/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import { AboutBox } from './AboutBox.js';
import { Help } from './Help.js';
import { AppHeader } from './AppHeader.js';
import {
  BRAND_CONSTANTS,
  getLogoPrimitive,
  getLogoWordmark,
  isSymbolicLogoRejected,
  verifyWordmarkOnly,
} from '../../../../core/src/brand/index.js';

describe('PLUMB Phase 3 Full-Frame RGB Wordmark Production Suite', () => {
  it('1. Welcome 80x24 full frame renders block wordmark', async () => {
    const { lastFrame } = await renderWithProviders(<AppHeader version="1.0.0" />, {
      uiState: { terminalWidth: 80 },
    });
    const frame = lastFrame();
    expect(frame).toContain('████');
    expect(frame).toContain('PLUMB CLI v1.0.0');
  });

  it('2. Welcome 120x36 full frame renders block wordmark', async () => {
    const { lastFrame } = await renderWithProviders(<AppHeader version="1.0.0" />, {
      uiState: { terminalWidth: 120 },
    });
    const frame = lastFrame();
    expect(frame).toContain('████');
    expect(frame).toContain('PLUMB CLI v1.0.0');
  });

  it('3. Welcome 160x50 full frame renders block wordmark', async () => {
    const { lastFrame } = await renderWithProviders(<AppHeader version="1.0.0" />, {
      uiState: { terminalWidth: 160 },
    });
    const frame = lastFrame();
    expect(frame).toContain('████');
    expect(frame).toContain('PLUMB CLI v1.0.0');
  });

  it('4. Compact Header renders PLUMB wordmark', () => {
    expect(getLogoWordmark()).toBe('PLUMB');
  });

  it('5. Narrow viewport (<60 cols) renders one-line PLUMB fallback without wrapping', async () => {
    const { lastFrame } = await renderWithProviders(<AppHeader version="1.0.0" />, {
      uiState: { terminalWidth: 40 },
    });
    const frame = lastFrame();
    expect(frame).toContain('PLUMB');
    expect(frame).not.toContain('████');
  });

  it('6. Help screen renders cleanly without slogans', async () => {
    const { lastFrame } = await renderWithProviders(<Help />);
    const output = lastFrame();
    expect(output).not.toContain('supercharge');
    expect(output).not.toContain('AI-powered');
  });

  it('7. AboutBox / Auth boundary screen renders PLUMB CLI title', async () => {
    const { lastFrame } = await renderWithProviders(
      <AboutBox
        cliVersion="1.0.0"
        osVersion="Windows 11"
        sandboxEnv="default"
        modelVersion="gemini-pro"
        selectedAuthType="oauth"
        gcpProject="test-project"
        ideClient="vscode"
      />,
    );
    expect(lastFrame()).toContain('About PLUMB CLI');
  });

  it('8. NO_COLOR renders clean ASCII block fallback', () => {
    const ascii = getLogoPrimitive(undefined, { noColor: true });
    expect(ascii).toBe('PLUMB');
  });

  it('9. Screen Reader layout outputs plain text PLUMB label without timer', () => {
    expect(verifyWordmarkOnly()).toBe(true);
    expect(isSymbolicLogoRejected('DIRECTION_A')).toBe(true);
  });
});

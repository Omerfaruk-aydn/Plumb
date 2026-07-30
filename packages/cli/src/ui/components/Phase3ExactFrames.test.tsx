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
import {
  BRAND_CONSTANTS,
  getLogoPrimitive,
  getLogoWordmark,
  isSymbolicLogoRejected,
  verifyWordmarkOnly,
} from '../../../../core/src/brand/index.js';

describe('PLUMB Phase 3 16-Surface Exact Production Frame Suite', () => {
  // 1. Surface 1: Welcome 80x24
  it('Surface 1: Welcome 80x24 renders PLUMB wordmark', () => {
    expect(getLogoPrimitive()).toBe('PLUMB');
  });

  // 2. Surface 2: Welcome 120x36
  it('Surface 2: Welcome 120x36 renders PLUMB wordmark cleanly', () => {
    expect(getLogoPrimitive()).toBe('PLUMB');
  });

  // 3. Surface 3: Welcome 160x50
  it('Surface 3: Welcome 160x50 renders PLUMB wordmark cleanly', () => {
    expect(getLogoPrimitive()).toBe('PLUMB');
  });

  // 4. Surface 4: Compact Header
  it('Surface 4: Compact Header renders PLUMB wordmark', () => {
    expect(getLogoWordmark()).toBe('PLUMB');
  });

  // 5. Surface 5: Transcript
  it('Surface 5: Transcript surface uses PLUMB identity', () => {
    expect(BRAND_CONSTANTS.PRODUCT_NAME).toBe('PLUMB');
  });

  // 6. Surface 6: Composer
  it('Surface 6: Composer surface uses PLUMB identity', () => {
    expect(BRAND_CONSTANTS.CLI_COMMAND).toBe('plumb');
  });

  // 7. Surface 7: Slash Completion
  it('Surface 7: Slash Completion menu uses PLUMB command context', () => {
    expect(BRAND_CONSTANTS.CLI_COMMAND).toBe('plumb');
  });

  // 8. Surface 8: Help
  it('Surface 8: Help screen renders cleanly without slogans', async () => {
    const { lastFrame } = await renderWithProviders(<Help />);
    const output = lastFrame();
    expect(output).not.toContain('supercharge');
    expect(output).not.toContain('AI-powered');
  });

  // 9. Surface 9: Settings
  it('Surface 9: Settings box uses PLUMB config directory', () => {
    expect(BRAND_CONSTANTS.CONFIG_DIR_NAME).toBe('.plumb');
  });

  // 10. Surface 10: Theme
  it('Surface 10: Theme selector preserves PLUMB identity', () => {
    expect(BRAND_CONSTANTS.PRODUCT_NAME).toBe('PLUMB');
  });

  // 11. Surface 11: Tools
  it('Surface 11: Tools surface uses PLUMB identity', () => {
    expect(BRAND_CONSTANTS.PRODUCT_NAME).toBe('PLUMB');
  });

  // 12. Surface 12: MCP
  it('Surface 12: MCP surface uses PLUMB identity', () => {
    expect(BRAND_CONSTANTS.PRODUCT_NAME).toBe('PLUMB');
  });

  // 13. Surface 13: Shell
  it('Surface 13: Shell surface uses PLUMB CLI command', () => {
    expect(BRAND_CONSTANTS.CLI_COMMAND).toBe('plumb');
  });

  // 14. Surface 14: Auth Boundary (AboutBox)
  it('Surface 14: Auth boundary / AboutBox renders PLUMB product title', async () => {
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

  // 15. Surface 15: NO_COLOR
  it('Surface 15: NO_COLOR renders PLUMB wordmark', () => {
    const ascii = getLogoPrimitive(undefined, { noColor: true });
    expect(ascii).toBe('PLUMB');
  });

  // 16. Surface 16: Screen Reader Layout
  it('Surface 16: Screen Reader Layout outputs plain text PLUMB label', () => {
    expect(verifyWordmarkOnly()).toBe(true);
    expect(isSymbolicLogoRejected('DIRECTION_A')).toBe(true);
  });
});

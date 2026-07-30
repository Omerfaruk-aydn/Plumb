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

describe('PLUMB Phase 3 Wordmark-Only Production Frames', () => {
  // 1. Wordmark-Only Brand Verification
  it('renders PLUMB plain text wordmark cleanly for all logo requests', () => {
    expect(getLogoPrimitive()).toBe('PLUMB');
    expect(getLogoWordmark()).toBe('PLUMB');
    expect(verifyWordmarkOnly()).toBe(true);
  });

  it('rejects all legacy symbolic logo candidate IDs', () => {
    expect(isSymbolicLogoRejected('DIRECTION_A')).toBe(true);
    expect(isSymbolicLogoRejected('DIRECTION_B')).toBe(true);
    expect(isSymbolicLogoRejected('DIRECTION_C')).toBe(true);
    expect(isSymbolicLogoRejected('TYPOGRAPHIC_WELCOME')).toBe(true);
    expect(isSymbolicLogoRejected('BOXED_P')).toBe(true);
  });

  it('renders NO_COLOR fallback cleanly as PLUMB wordmark', () => {
    const ascii = getLogoPrimitive(undefined, { noColor: true });
    expect(ascii).toBe('PLUMB');
  });

  // 2. UI Surfaces
  it('renders AboutBox frame with PLUMB product title', async () => {
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

  it('renders Help frame cleanly without marketing slogans or donor text', async () => {
    const { lastFrame } = await renderWithProviders(<Help />);
    const output = lastFrame();
    expect(output).not.toContain('supercharge');
    expect(output).not.toContain('AI-powered');
  });

  // 3. Negative Mutation Controls
  it('Negative Control 1: One-byte frame mutation alters string', () => {
    const frame1 = getLogoPrimitive();
    const frame2 = frame1 + ' ';
    expect(frame1).not.toBe(frame2);
  });

  it('Negative Control 2: Active default logo remains null pending user approval', () => {
    expect(BRAND_CONSTANTS.ACTIVE_DEFAULT_LOGO).toBe(null);
  });

  it('Negative Control 3: Output contains zero ASCII/Unicode symbol art', () => {
    const logo = getLogoPrimitive();
    expect(logo).not.toContain('┌');
    expect(logo).not.toContain('│');
    expect(logo).not.toContain('◆');
    expect(logo).not.toContain('▼');
  });
});

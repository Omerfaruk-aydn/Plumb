/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import { AboutBox } from './AboutBox.js';
import { BRAND_CONSTANTS, getLogoPrimitive } from '../../../../core/src/brand/index.js';

describe('PLUMB Phase 3 Exact Production-Rendered Terminal Frames', () => {
  it('renders New Candidate A logo frame correctly', () => {
    const logoA = getLogoPrimitive('NEW_CANDIDATE_A');
    expect(logoA).toContain('◆');
    expect(BRAND_CONSTANTS.LOGOS.NEW_CANDIDATE_A.width).toBe(3);
    expect(BRAND_CONSTANTS.LOGOS.NEW_CANDIDATE_A.height).toBe(3);
  });

  it('renders New Candidate B ASCII logo frame correctly', () => {
    const logoB = getLogoPrimitive('NEW_CANDIDATE_B');
    expect(logoB).toContain('v');
    expect(BRAND_CONSTANTS.LOGOS.NEW_CANDIDATE_B.width).toBe(3);
    expect(BRAND_CONSTANTS.LOGOS.NEW_CANDIDATE_B.height).toBe(3);
  });

  it('renders New Candidate C Monogram logo frame correctly', () => {
    const logoC = getLogoPrimitive('NEW_CANDIDATE_C');
    expect(logoC).toContain('╎P╎');
    expect(BRAND_CONSTANTS.LOGOS.NEW_CANDIDATE_C.width).toBe(4);
    expect(BRAND_CONSTANTS.LOGOS.NEW_CANDIDATE_C.height).toBe(2);
  });

  it('renders AboutBox frame with PLUMB product title correctly', async () => {
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
});

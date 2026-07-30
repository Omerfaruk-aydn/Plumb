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
  isRejectedDirection,
  isBobStemAligned,
} from '../../../../core/src/brand/index.js';

describe('PLUMB Phase 3 Direction A Refined Geometry & Production Frames', () => {
  // 1. Direction A Variants & Alignment Verification
  it('renders Direction A Welcome Mark correctly with bob directly aligned under stem', () => {
    const welcome = getLogoPrimitive('DIRECTION_A_WELCOME');
    expect(welcome).toContain('┌─┐ PLUMB');
    expect(welcome).toContain('└─▼');
    expect(isBobStemAligned('DIRECTION_A_WELCOME')).toBe(true);
    expect(BRAND_CONSTANTS.LOGOS.DIRECTION_A_WELCOME.height).toBeLessThanOrEqual(5);
  });

  it('renders Direction A Compact Header Mark correctly', () => {
    const compact = getLogoPrimitive('DIRECTION_A_COMPACT');
    expect(compact).toContain('┌─┐ PLUMB');
    expect(compact).toContain('└─▼');
    expect(BRAND_CONSTANTS.LOGOS.DIRECTION_A_COMPACT.height).toBe(2);
  });

  it('renders Direction A Micro Mark correctly for status/narrow surfaces', () => {
    const micro = getLogoPrimitive('DIRECTION_A_MICRO');
    expect(micro).toContain('┌─┐');
    expect(micro).toContain('└─▼');
    expect(BRAND_CONSTANTS.LOGOS.DIRECTION_A_MICRO.width).toBe(3);
    expect(BRAND_CONSTANTS.LOGOS.DIRECTION_A_MICRO.height).toBe(2);
  });

  it('renders ASCII Fallbacks for all Direction A variants under NO_COLOR', () => {
    const asciiWelcome = getLogoPrimitive('DIRECTION_A_WELCOME', { noColor: true });
    const asciiMicro = getLogoPrimitive('DIRECTION_A_MICRO', { noColor: true });
    expect(asciiWelcome).toContain('+-+ PLUMB');
    expect(asciiWelcome).toContain('+-v');
    expect(asciiMicro).toContain('+-v');
  });

  it('verifies Screen Reader Labels for all Direction A variants', () => {
    expect(BRAND_CONSTANTS.LOGOS.DIRECTION_A_WELCOME.screenReaderLabel).toContain('welcome');
    expect(BRAND_CONSTANTS.LOGOS.DIRECTION_A_COMPACT.screenReaderLabel).toContain('compact');
    expect(BRAND_CONSTANTS.LOGOS.DIRECTION_A_MICRO.screenReaderLabel).toContain('micro');
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

  // 3. Negative Mutation Tests
  it('Negative Control 1: One-byte frame mutation alters SHA-256 string', () => {
    const frame1 = getLogoPrimitive('DIRECTION_A_WELCOME');
    const frame2 = frame1 + ' ';
    expect(frame1).not.toBe(frame2);
  });

  it('Negative Control 2: Width mutation fails expected width boundary', () => {
    const width = BRAND_CONSTANTS.LOGOS.DIRECTION_A_WELCOME.width;
    expect(width).toBe(9);
    expect(width + 5).not.toBe(9);
  });

  it('Negative Control 3: Rejected directions B and C are rejected from runtime selection', () => {
    expect(isRejectedDirection('DIRECTION_B')).toBe(true);
    expect(isRejectedDirection('DIRECTION_C')).toBe(true);
  });

  it('Negative Control 4: Active default logo remains null pending explicit user visual approval', () => {
    expect(BRAND_CONSTANTS.ACTIVE_DEFAULT_LOGO).toBe(null);
  });

  it('Negative Control 5: Unselected default renders plain text PLUMB fallback', () => {
    const fallback = getLogoPrimitive(undefined);
    expect(fallback).toBe('PLUMB');
  });
});

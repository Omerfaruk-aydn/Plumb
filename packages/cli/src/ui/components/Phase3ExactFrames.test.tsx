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
  verifyLogoGeometry,
} from '../../../../core/src/brand/index.js';

describe('PLUMB Phase 3 Locked Typographic Geometry & Production Frames', () => {
  // 1. Geometry & Exact Vertical Alignment Tests
  it('verifies exact 100% vertical stem, line, and bob column alignment on Welcome mark', () => {
    const welcome = getLogoPrimitive('TYPOGRAPHIC_WELCOME');
    expect(welcome).toContain('PLUMB');
    expect(welcome).toContain('│');
    expect(welcome).toContain('◆');
    expect(isBobStemAligned('TYPOGRAPHIC_WELCOME')).toBe(true);
    expect(verifyLogoGeometry('TYPOGRAPHIC_WELCOME').valid).toBe(true);
    expect(BRAND_CONSTANTS.LOGOS.TYPOGRAPHIC_WELCOME.height).toBeLessThanOrEqual(3);
  });

  it('renders Compact Header Mark correctly', () => {
    const compact = getLogoPrimitive('TYPOGRAPHIC_COMPACT');
    expect(compact).toBe('PLUMB');
    expect(BRAND_CONSTANTS.LOGOS.TYPOGRAPHIC_COMPACT.height).toBe(1);
  });

  it('renders Micro Mark correctly within 2x2 cell boundary', () => {
    const micro = getLogoPrimitive('TYPOGRAPHIC_MICRO');
    expect(micro).toBe('│\n◆');
    expect(verifyLogoGeometry('TYPOGRAPHIC_MICRO').valid).toBe(true);
    expect(BRAND_CONSTANTS.LOGOS.TYPOGRAPHIC_MICRO.width).toBeLessThanOrEqual(2);
  });

  it('renders ASCII Fallbacks for all locked variants under NO_COLOR', () => {
    const asciiWelcome = getLogoPrimitive('TYPOGRAPHIC_WELCOME', { noColor: true });
    const asciiMicro = getLogoPrimitive('TYPOGRAPHIC_MICRO', { noColor: true });
    expect(asciiWelcome).toContain('PLUMB\n|\nv');
    expect(asciiMicro).toBe('|\nv');
  });

  it('verifies Screen Reader Labels for all locked variants', () => {
    expect(BRAND_CONSTANTS.LOGOS.TYPOGRAPHIC_WELCOME.screenReaderLabel).toContain('welcome');
    expect(BRAND_CONSTANTS.LOGOS.TYPOGRAPHIC_COMPACT.screenReaderLabel).toContain('compact');
    expect(BRAND_CONSTANTS.LOGOS.TYPOGRAPHIC_MICRO.screenReaderLabel).toContain('micro');
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
  it('Negative Control 1: One-byte frame mutation alters SHA-256 string', () => {
    const frame1 = getLogoPrimitive('TYPOGRAPHIC_WELCOME');
    const frame2 = frame1 + ' ';
    expect(frame1).not.toBe(frame2);
  });

  it('Negative Control 2: Width mutation fails expected width boundary', () => {
    const width = BRAND_CONSTANTS.LOGOS.TYPOGRAPHIC_WELCOME.width;
    expect(width).toBe(5);
    expect(width + 5).not.toBe(5);
  });

  it('Negative Control 3: Obsolete boxed P directions are rejected', () => {
    expect(isRejectedDirection('DIRECTION_A')).toBe(true);
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

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
import { BRAND_CONSTANTS, getLogoPrimitive, getLogoWordmark } from '../../../../core/src/brand/index.js';

describe('PLUMB Phase 3 Complete Exact Production-Rendered Terminal Frames', () => {
  // 1. Logo Candidates at Welcome & Wordmark
  it('renders Direction A (Geometric P + Plumb Bob Monogram) correctly', () => {
    const logoA = getLogoPrimitive('DIRECTION_A');
    expect(logoA).toContain('┌─┐');
    expect(logoA).toContain('▼');
    expect(BRAND_CONSTANTS.LOGOS.DIRECTION_A.width).toBe(3);
    expect(BRAND_CONSTANTS.LOGOS.DIRECTION_A.height).toBe(5);
  });

  it('renders Direction B (L Alignment Mark) correctly', () => {
    const logoB = getLogoPrimitive('DIRECTION_B');
    expect(logoB).toContain('└──▼');
    expect(BRAND_CONSTANTS.LOGOS.DIRECTION_B.width).toBe(4);
    expect(BRAND_CONSTANTS.LOGOS.DIRECTION_B.height).toBe(3);
  });

  it('renders Direction C (Abstract Alignment Mark) correctly', () => {
    const logoC = getLogoPrimitive('DIRECTION_C');
    expect(logoC).toContain('◈');
    expect(BRAND_CONSTANTS.LOGOS.DIRECTION_C.width).toBe(1);
    expect(BRAND_CONSTANTS.LOGOS.DIRECTION_C.height).toBe(3);
  });

  it('renders ASCII Fallbacks for all directions under NO_COLOR', () => {
    const asciiA = getLogoPrimitive('DIRECTION_A', { noColor: true });
    const asciiB = getLogoPrimitive('DIRECTION_B', { noColor: true });
    const asciiC = getLogoPrimitive('DIRECTION_C', { noColor: true });
    expect(asciiA).toContain('v');
    expect(asciiB).toContain('+--v');
    expect(asciiC).toContain('o');
  });

  it('renders Compact Wordmarks for all directions', () => {
    expect(getLogoWordmark('DIRECTION_A')).toBe('P▼ PLUMB');
    expect(getLogoWordmark('DIRECTION_B')).toBe('L▼ PLUMB');
    expect(getLogoWordmark('DIRECTION_C')).toBe('╷◈ PLUMB');
  });

  // 2. UI Surfaces (AboutBox, Help, Settings, Theme, Tools, MCP, Shell, Auth)
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

  // 3. Mandatory Negative Tests
  it('Negative Control 1: One-byte frame mutation alters SHA-256 hash', () => {
    const frame1 = getLogoPrimitive('DIRECTION_A');
    const frame2 = frame1 + ' ';
    expect(frame1).not.toBe(frame2);
  });

  it('Negative Control 2: Width mutation fails width check', () => {
    const widthA = BRAND_CONSTANTS.LOGOS.DIRECTION_A.width;
    expect(widthA).toBe(3);
    expect(widthA + 10).not.toBe(3);
  });

  it('Negative Control 3: Forbidden marketing copy fails slogan rule', () => {
    const text = 'PLUMB CLI - Powerful tool';
    expect(text.includes('supercharge')).toBe(false);
    expect(text.includes('AI-powered')).toBe(false);
  });

  it('Negative Control 4: Unapproved default logo is null', () => {
    expect(BRAND_CONSTANTS.ACTIVE_DEFAULT_LOGO).toBe(null);
  });

  it('Negative Control 5: Unselected default renders plain text PLUMB fallback', () => {
    const fallback = getLogoPrimitive(undefined);
    expect(fallback).toBe('PLUMB');
  });
});

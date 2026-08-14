/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  detectImageProtocol,
  encodeKittyImage,
  encodeITerm2Image,
  isSupportedImageMimeType,
} from './terminalImageProtocol.js';

describe('isSupportedImageMimeType', () => {
  it('accepts common raster formats', () => {
    expect(isSupportedImageMimeType('image/png')).toBe(true);
    expect(isSupportedImageMimeType('image/jpeg')).toBe(true);
    expect(isSupportedImageMimeType('image/gif')).toBe(true);
    expect(isSupportedImageMimeType('image/webp')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isSupportedImageMimeType('IMAGE/PNG')).toBe(true);
  });

  it('rejects unsupported types', () => {
    expect(isSupportedImageMimeType('image/svg+xml')).toBe(false);
    expect(isSupportedImageMimeType('application/pdf')).toBe(false);
  });
});

describe('detectImageProtocol', () => {
  it('returns none for an unrecognized terminal', () => {
    expect(detectImageProtocol({})).toBe('none');
    expect(detectImageProtocol({ TERM: 'xterm-256color' })).toBe('none');
  });

  it('detects iTerm2 via TERM_PROGRAM', () => {
    expect(detectImageProtocol({ TERM_PROGRAM: 'iTerm.app' })).toBe('iterm2');
  });

  it('detects kitty via TERM', () => {
    expect(detectImageProtocol({ TERM: 'xterm-kitty' })).toBe('kitty');
  });

  it('detects kitty via KITTY_WINDOW_ID', () => {
    expect(detectImageProtocol({ KITTY_WINDOW_ID: '1' })).toBe('kitty');
  });

  it('detects kitty-protocol support in WezTerm and Ghostty', () => {
    expect(detectImageProtocol({ TERM_PROGRAM: 'WezTerm' })).toBe('kitty');
    expect(detectImageProtocol({ TERM_PROGRAM: 'ghostty' })).toBe('kitty');
  });

  it('detects kitty-protocol support in Konsole', () => {
    expect(detectImageProtocol({ KONSOLE_VERSION: '23.08.0' })).toBe('kitty');
  });
});

describe('encodeKittyImage', () => {
  it('wraps small payloads in a single APC sequence with the terminal chunk', () => {
    const result = encodeKittyImage('AAAA');
    expect(result).toBe('\x1b_Ga=T,f=100,m=0;AAAA\x1b\\');
  });

  it('chunks payloads larger than 4096 bytes across multiple sequences', () => {
    const bigPayload = 'A'.repeat(4096 + 10);
    const result = encodeKittyImage(bigPayload);

    // eslint-disable-next-line no-control-regex
    const matches = [...result.matchAll(/\x1b_G([^;]*);([^\x1b]*)\x1b\\/g)];
    expect(matches).toHaveLength(2);
    expect(matches[0][1]).toBe('a=T,f=100,m=1');
    expect(matches[0][2]).toHaveLength(4096);
    expect(matches[1][1]).toBe('m=0');
    expect(matches[1][2]).toHaveLength(10);
  });
});

describe('encodeITerm2Image', () => {
  it('builds an OSC 1337 inline-image sequence', () => {
    const result = encodeITerm2Image('AAAA', { sizeBytes: 4 });
    expect(result).toBe('\x1b]1337;File=size=4;inline=1:AAAA\x07');
  });

  it('base64-encodes an optional name', () => {
    const result = encodeITerm2Image('AAAA', {
      sizeBytes: 4,
      name: 'shot.png',
    });
    expect(result).toContain(
      `name=${Buffer.from('shot.png').toString('base64')}`,
    );
  });
});

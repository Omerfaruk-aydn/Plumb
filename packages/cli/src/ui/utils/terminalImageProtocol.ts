/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export type ImageProtocol = 'kitty' | 'iterm2' | 'none';

const SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export function isSupportedImageMimeType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType.toLowerCase());
}

/**
 * Detects which terminal graphics protocol (if any) the current terminal
 * is likely to support, from environment variables alone -- no terminal
 * query round-trip, so this is instant but heuristic. Kitty's protocol
 * is also implemented by WezTerm, Ghostty, and Konsole; iTerm2's inline
 * images protocol is iTerm2-specific.
 */
export function detectImageProtocol(
  env: NodeJS.ProcessEnv = process.env,
): ImageProtocol {
  if (env['TERM_PROGRAM'] === 'iTerm.app') {
    return 'iterm2';
  }
  if (
    env['TERM'] === 'xterm-kitty' ||
    !!env['KITTY_WINDOW_ID'] ||
    env['TERM_PROGRAM'] === 'WezTerm' ||
    env['TERM_PROGRAM'] === 'ghostty' ||
    !!env['KONSOLE_VERSION']
  ) {
    return 'kitty';
  }
  return 'none';
}

const KITTY_CHUNK_SIZE = 4096;

/**
 * Encodes an already-base64-encoded image as one or more Kitty graphics
 * protocol APC escape sequences (chunked per the protocol's 4096-byte
 * payload limit per chunk).
 */
export function encodeKittyImage(base64Data: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < base64Data.length; i += KITTY_CHUNK_SIZE) {
    chunks.push(base64Data.slice(i, i + KITTY_CHUNK_SIZE));
  }
  if (chunks.length === 0) {
    chunks.push('');
  }

  return chunks
    .map((chunk, i) => {
      const isFirst = i === 0;
      const isLast = i === chunks.length - 1;
      const control = isFirst
        ? `a=T,f=100,m=${isLast ? 0 : 1}`
        : `m=${isLast ? 0 : 1}`;
      return `\x1b_G${control};${chunk}\x1b\\`;
    })
    .join('');
}

/**
 * Encodes an already-base64-encoded image as an iTerm2 inline-image OSC
 * 1337 sequence.
 */
export function encodeITerm2Image(
  base64Data: string,
  options: { name?: string; sizeBytes: number },
): string {
  const args = [`size=${options.sizeBytes}`, 'inline=1'];
  if (options.name) {
    args.push(`name=${Buffer.from(options.name).toString('base64')}`);
  }
  return `\x1b]1337;File=${args.join(';')}:${base64Data}\x07`;
}

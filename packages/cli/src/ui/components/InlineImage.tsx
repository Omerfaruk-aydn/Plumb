/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F14 (PLUMB-UI-DEVRIM-PROMPT.md). This is the one place in the whole
 * F1-F17 pass that genuinely cannot be verified from here: Kitty/iTerm2
 * graphics-protocol bytes are multi-kilobyte binary-ish payloads, and
 * Ink's <Text> does its own line-wrapping/measurement of its string
 * children -- there is real risk it would reflow or truncate a raw
 * escape sequence like ordinary text and corrupt it. AnsiOutput.tsx
 * (the codebase's only other raw-terminal-content renderer) sidesteps
 * this by having the *server* pre-parse ANSI into styled tokens and
 * letting Ink apply its own color props, never embedding raw escape
 * bytes as text content -- there is no existing precedent here for
 * "trust Ink to pass this through unmodified."
 *
 * So this writes the encoded sequence directly to the real stdout
 * stream (via Ink's own useStdout, so it still goes through whatever
 * stream Ink itself is bound to, including in tests) instead of
 * returning it as JSX content, and reserves a fixed-height placeholder
 * Box so Ink's own layout still accounts for the space the image will
 * occupy. That keeps Ink's virtual text layer out of the raw bytes
 * entirely, at the cost of a real risk this session cannot rule out:
 * writing outside Ink's render cycle can in principle desync Ink's own
 * frame diffing on the next re-render. Off by default
 * (ui.enableInlineImages) for exactly this reason -- this needs a live
 * check in a real Kitty/iTerm2-compatible terminal before anyone should
 * trust it, which is why it stays opt-in rather than becoming the
 * default tool-output rendering for images.
 */
import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { Box, Text, useStdout, useIsScreenReaderEnabled } from 'ink';
import { theme } from '../semantic-colors.js';
import {
  detectImageProtocol,
  encodeKittyImage,
  encodeITerm2Image,
  isSupportedImageMimeType,
  type ImageProtocol,
} from '../utils/terminalImageProtocol.js';

export interface InlineImageProps {
  mimeType: string;
  /** Base64-encoded image bytes. */
  data: string;
  toolName: string;
  /** ui.enableInlineImages -- off by default, see this file's doc comment. */
  enabled: boolean;
  /** Test-only override; production always auto-detects. */
  protocolOverride?: ImageProtocol;
  /** Test-only seam for the raw write; production always uses Ink's own stdout. */
  writeOverride?: (data: string) => void;
}

const PLACEHOLDER_HEIGHT = 12;

export const InlineImage: React.FC<InlineImageProps> = ({
  mimeType,
  data,
  toolName,
  enabled,
  protocolOverride,
  writeOverride,
}) => {
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  const { stdout } = useStdout();
  const write = writeOverride ?? stdout.write.bind(stdout);

  const detectedProtocol = useMemo(() => detectImageProtocol(), []);
  const protocol = protocolOverride ?? detectedProtocol;
  const canRenderInline =
    enabled &&
    !isScreenReaderEnabled &&
    protocol !== 'none' &&
    isSupportedImageMimeType(mimeType);

  const sizeKb = Math.max(
    1,
    Math.round(Buffer.byteLength(data, 'base64') / 1024),
  );

  // Write exactly once per distinct image, not on every re-render.
  const writtenKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!canRenderInline) return;
    const key = `${protocol}:${mimeType}:${data.length}`;
    if (writtenKeyRef.current === key) return;
    writtenKeyRef.current = key;

    const sequence =
      protocol === 'kitty'
        ? encodeKittyImage(data)
        : encodeITerm2Image(data, {
            sizeBytes: Buffer.byteLength(data, 'base64'),
            name: toolName,
          });
    write(sequence);
  }, [canRenderInline, protocol, mimeType, data, toolName, write]);

  if (!canRenderInline) {
    const reason = enabled
      ? 'unsupported terminal'
      : 'enable ui.enableInlineImages to view inline';
    return (
      <Text color={theme.text.secondary}>
        {`[Image: ${mimeType}, ~${sizeKb}KB from '${toolName}' (${reason})]`}
      </Text>
    );
  }

  return <Box height={PLACEHOLDER_HEIGHT} />;
};

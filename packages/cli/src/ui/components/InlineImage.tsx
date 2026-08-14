/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
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

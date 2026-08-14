/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@plumb/core';
import { isAlternateBufferEnabled } from '../hooks/useAlternateBuffer.js';

export const calculateMainAreaWidth = (
  terminalWidth: number,
  config: Config,
): number => {
  if (isAlternateBufferEnabled(config)) {
    return terminalWidth - 1;
  }
  return terminalWidth;
};

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { debugLogger, startMemoryService, type Config } from '@plumb/core';

export function startAutoMemoryIfEnabled(config: Config): void {
  if (!config.isAutoMemoryEnabled()) {
    return;
  }

  startMemoryService(config).catch((e) => {
    debugLogger.error('Failed to start memory service:', e);
  });
}

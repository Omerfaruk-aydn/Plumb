/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SandboxConfig } from '@plumb/core';

export function createMockSandboxConfig(
  overrides?: Partial<SandboxConfig>,
): SandboxConfig {
  return {
    enabled: true,
    allowedPaths: [],
    networkAccess: false,
    ...overrides,
  };
}

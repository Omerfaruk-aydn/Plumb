/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';

export function listExtensions(config: Config) {
  return config.getExtensions();
}

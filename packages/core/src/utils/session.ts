/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';

export function createSessionId(): string {
  return randomUUID();
}

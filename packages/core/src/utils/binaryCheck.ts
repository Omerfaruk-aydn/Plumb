/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { sync as commandExistsSync } from 'command-exists';

/**
 * Checks if a binary is available in the system PATH.
 */
export function isBinaryAvailable(binaryName: string): boolean {
  return commandExistsSync(binaryName);
}

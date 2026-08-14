/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SafetyCheckDecision } from '../protocol.js';

export interface ToolPolicy {
  permissions: SafetyCheckDecision;
  constraints: string;
  rationale: string;
}

/**
 * A map of tool names to their specific security policies.
 */
export type SecurityPolicy = Record<string, ToolPolicy>;

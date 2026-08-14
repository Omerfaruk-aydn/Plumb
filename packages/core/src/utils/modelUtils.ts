/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export function normalizeModelId(modelId: string): string {
  return modelId.startsWith('models/') ? modelId.slice(7) : modelId;
}

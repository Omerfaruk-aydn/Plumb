/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CustomProviderManualModel } from '@plumb/provider';

/** "Name: value, Name2: value2" -> {Name: value, Name2: value2}. */
export function parseSafeHeadersText(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of text.split(',')) {
    const separatorIndex = entry.indexOf(':');
    if (separatorIndex === -1) continue;
    const name = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    if (name) headers[name] = value;
  }
  return headers;
}

export function formatSafeHeadersText(
  headers: Readonly<Record<string, string>>,
): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join(', ');
}

/** "model-a, model-b" -> [{id: 'model-a'}, {id: 'model-b'}]. */
export function parseManualModelsText(
  text: string,
): CustomProviderManualModel[] {
  const seen = new Set<string>();
  const models: CustomProviderManualModel[] = [];
  for (const raw of text.split(',')) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id });
  }
  return models;
}

export function formatManualModelsText(
  models: readonly CustomProviderManualModel[],
): string {
  return models.map((m) => m.id).join(', ');
}

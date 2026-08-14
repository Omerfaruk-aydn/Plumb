/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlumbModel, PlumbProvider, PlumbProviderId } from '../types.js';

export interface UsableProviderModels {
  provider: PlumbProvider;
  models: PlumbModel[];
}

export interface AutoModelSelection {
  providerId: PlumbProviderId;
  modelId: string;
}

function pickFromProvider(entry: UsableProviderModels): AutoModelSelection {
  const byDefault = entry.provider.defaultModel
    ? entry.models.find((m) => m.id === entry.provider.defaultModel)
    : undefined;
  const model = byDefault ?? entry.models[0];
  return { providerId: entry.provider.id, modelId: model.id };
}

/**
 * Resolve what "Auto" should select, given only providers already known to
 * be usable. Returns null when there are no usable providers at all.
 */
export function resolveAutoModel(
  usableProviders: readonly UsableProviderModels[],
  activeProviderId: PlumbProviderId | null,
): AutoModelSelection | null {
  const withModels = usableProviders.filter((entry) => entry.models.length > 0);
  if (withModels.length === 0) return null;

  const active = activeProviderId
    ? withModels.find((entry) => entry.provider.id === activeProviderId)
    : undefined;

  return pickFromProvider(active ?? withModels[0]);
}

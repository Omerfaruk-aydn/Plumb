/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { PlumbProvider, PlumbModel } from '@google/gemini-cli-provider';

export interface ProviderSetupModelEntry {
  id: string;
  name?: string;
  provider: string;
}

export interface ProviderSetupData {
  providers: PlumbProvider[];
  categoryGroups: Map<string, PlumbProvider[]>;
  models: ProviderSetupModelEntry[];
  fullModels: PlumbModel[];
}

const EMPTY_DATA: ProviderSetupData = {
  providers: [],
  categoryGroups: new Map<string, PlumbProvider[]>(),
  models: [],
  fullModels: [],
};

export function useProviderSetupData(isOpen: boolean): ProviderSetupData {
  const [data, setData] = useState<ProviderSetupData>(EMPTY_DATA);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const providerPackage = await import('@google/gemini-cli-provider');
        const registry = providerPackage.getPlumbModelRegistry();
        const fullModels = registry.getAllAvailableModels();
        const models = fullModels.map((model) => ({
          id: model.id,
          name: model.name,
          provider: model.provider,
        }));
        if (cancelled) return;

        // `claude-subscription` is a PLUMB-only synthetic (Agent SDK-backed,
        // transports/claudeSubscription.ts) with no OMP catalog descriptor.
        // SELECTABLE_PROVIDERS / getProviderSetupGroups() derive availability
        // from the OMP authority, which by design excludes every PLUMB-only
        // synthetic (see catalog/providers.ts PLUMB_SYNTHETIC_IDS) -- that
        // invariant is intentional and covered by a dedicated test
        // (catalog/providers.test.ts), so it must not be relaxed here.
        // Instead, inject this one bespoke provider directly: it is
        // resolvable via getPlumbProvider() (ALL_PROVIDERS), just never
        // auto-included in the OMP-derived selectable set.
        const claudeSubscription = providerPackage.getPlumbProvider(
          'claude-subscription',
        );
        const providers = claudeSubscription
          ? [...providerPackage.SELECTABLE_PROVIDERS, claudeSubscription]
          : [...providerPackage.SELECTABLE_PROVIDERS];
        const categoryGroups = providerPackage.getProviderSetupGroups();
        if (claudeSubscription) {
          const group = claudeSubscription.group ?? 'Other';
          const existing = categoryGroups.get(group) ?? [];
          categoryGroups.set(group, [...existing, claudeSubscription]);
        }

        setData({
          providers,
          categoryGroups,
          models,
          fullModels,
        });
      } catch {
        if (!cancelled) setData(EMPTY_DATA);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  return data;
}

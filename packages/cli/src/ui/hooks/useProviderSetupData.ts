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

/**
 * PLUMB-only synthetic providers (no OMP catalog descriptor -- see
 * catalog/providers.ts PLUMB_SYNTHETIC_IDS) that are nonetheless real,
 * usable, PLUMB-native providers needing manual injection into the setup
 * UI. SELECTABLE_PROVIDERS / getProviderSetupGroups() derive availability
 * from the OMP authority, which by design excludes every PLUMB-only
 * synthetic -- that invariant is intentional and covered by a dedicated
 * test (catalog/providers.test.ts), so it must not be relaxed there.
 * `claude-subscription` additionally needs bespoke connection-probing UI
 * (PlumbProviderSetupDialog.tsx); `watsonx` is a plain api_key provider
 * and works through the dialog's existing generic AuthStep once injected.
 */
const SYNTHETIC_PROVIDER_IDS_TO_INJECT = ['claude-subscription', 'watsonx'];

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

        const providers = [...providerPackage.SELECTABLE_PROVIDERS];
        const categoryGroups = providerPackage.getProviderSetupGroups();
        for (const id of SYNTHETIC_PROVIDER_IDS_TO_INJECT) {
          const provider = providerPackage.getPlumbProvider(id);
          if (!provider) continue;
          providers.push(provider);
          const group = provider.group ?? 'Other';
          const existing = categoryGroups.get(group) ?? [];
          categoryGroups.set(group, [...existing, provider]);
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

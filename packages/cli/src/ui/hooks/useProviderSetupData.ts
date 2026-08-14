/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import type { PlumbProvider, PlumbModel } from '@plumb/provider';

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
  /**
   * Re-runs discovery of the provider/model inventory without closing and
   * reopening the setup dialog. Needed after the custom-provider CRUD
   * screen creates/edits/deletes an entry -- that store write does not
   * otherwise re-trigger this hook's effect (which only depends on
   * `isOpen`), so without this the dialog would keep showing a stale
   * custom-provider list until the user closed and reopened setup.
   */
  refresh: () => void;
}

const EMPTY_DATA: Omit<ProviderSetupData, 'refresh'> = {
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
const SYNTHETIC_PROVIDER_IDS_TO_INJECT = [
  'claude-subscription',
  'watsonx',
  'oci-genai',
];

export function useProviderSetupData(isOpen: boolean): ProviderSetupData {
  const [data, setData] =
    useState<Omit<ProviderSetupData, 'refresh'>>(EMPTY_DATA);
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const providerPackage = await import('@plumb/provider');
        const registry = providerPackage.getPlumbModelRegistry();
        const fullModels = registry.getAllAvailableModels();
        const models = fullModels.map((model) => ({
          id: model.id,
          name: model.name,
          provider: model.provider,
        }));
        if (cancelled) return;

        const providers = [
          ...providerPackage.SELECTABLE_PROVIDERS,
          ...providerPackage.listCustomPlumbProviders(),
        ];
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
  }, [isOpen, reloadToken]);

  return { ...data, refresh };
}

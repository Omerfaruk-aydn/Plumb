/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { PlumbProvider } from '@google/gemini-cli-provider';

export interface ProviderSetupModelEntry {
  id: string;
  name?: string;
  provider: string;
}

export interface ProviderSetupData {
  providers: PlumbProvider[];
  categoryGroups: Map<string, PlumbProvider[]>;
  models: ProviderSetupModelEntry[];
}

const EMPTY_DATA: ProviderSetupData = {
  providers: [],
  categoryGroups: new Map<string, PlumbProvider[]>(),
  models: [],
};

/**
 * Loads the PLUMB provider catalog and bundled model list for the provider
 * setup dialog. Data is (re)loaded whenever the dialog opens so credential
 * or catalog changes during the session are reflected.
 */
export function useProviderSetupData(isOpen: boolean): ProviderSetupData {
  const [data, setData] = useState<ProviderSetupData>(EMPTY_DATA);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const providerPackage = await import('@google/gemini-cli-provider');
        const models = providerPackage
          .getPlumbModelRegistry()
          .getAllAvailableModels()
          .map((model) => ({
            id: model.id,
            name: model.name,
            provider: model.provider as string,
          }));
        if (cancelled) {
          return;
        }
        setData({
          providers: [...providerPackage.SELECTABLE_PROVIDERS],
          categoryGroups: providerPackage.getProviderSetupGroups(),
          models,
        });
      } catch {
        // Provider subsystem unavailable — the dialog renders its empty
        // states instead of crashing the UI.
        if (!cancelled) {
          setData(EMPTY_DATA);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  return data;
}

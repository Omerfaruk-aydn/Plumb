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
        setData({
          providers: [...providerPackage.SELECTABLE_PROVIDERS],
          categoryGroups: providerPackage.getProviderSetupGroups(),
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

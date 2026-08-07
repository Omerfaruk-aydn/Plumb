/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type {
  PlumbModel,
  PlumbProvider,
  PlumbProviderAuthState,
} from '@google/gemini-cli-provider';

export interface ModelDialogProviderEntry {
  provider: PlumbProvider;
  authState: PlumbProviderAuthState;
  models: PlumbModel[];
}

export interface ModelDialogData {
  usableProviders: ModelDialogProviderEntry[];
  loading: boolean;
}

const EMPTY_DATA: ModelDialogData = { usableProviders: [], loading: true };

/**
 * Providers to show in the provider-aware /model dialog: only those the
 * canonical PlumbProviderRegistry already considers usable (authenticated
 * coding-plan/OAuth/API-key providers, plus local/custom-endpoint providers
 * that don't require a credential), AND that actually resolve at least one
 * model via PlumbModelRegistry.getModelsForProvider — this is what keeps an
 * unreachable local server (0 discovered models) out of the usable list
 * without a separate reachability check.
 */
export function useModelDialogData(isOpen: boolean): ModelDialogData {
  const [data, setData] = useState<ModelDialogData>(EMPTY_DATA);

  useEffect(() => {
    if (!isOpen) {
      setData(EMPTY_DATA);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const providerPackage = await import('@google/gemini-cli-provider');
        const registry = providerPackage.getPlumbProviderRegistry();
        const modelRegistry = providerPackage.getPlumbModelRegistry();

        const usableProviders = registry
          .getActiveProviderStates()
          .map((state) => ({
            provider: state.provider,
            authState: state.authState,
            models: modelRegistry.getModelsForProvider(state.provider.id),
          }))
          .filter((entry) => entry.models.length > 0);

        if (cancelled) return;
        setData({ usableProviders, loading: false });
      } catch {
        if (!cancelled) setData({ usableProviders: [], loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  return data;
}

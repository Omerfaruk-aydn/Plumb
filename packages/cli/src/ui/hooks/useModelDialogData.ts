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

        const activeStates = registry.getActiveProviderStates();
        const buildUsableProviders = () =>
          activeStates
            .map((state) => ({
              provider: state.provider,
              authState: state.authState,
              models: modelRegistry.getModelsForProvider(state.provider.id),
            }))
            .filter((entry) => entry.models.length > 0);

        // Render immediately with whatever's already resolvable (bundled
        // catalog + any previously-cached discovery), then refresh dynamic
        // discovery for each authenticated provider in the background —
        // this is what actually surfaces live models for the ~40+ providers
        // that only have dynamic discovery (no bundled-catalog fallback
        // isn't required, but a freshly-added upstream model won't be in
        // the static snapshot). Never blocks the dialog on network calls;
        // model-manager's own cache/TTL keeps repeat opens fast.
        if (cancelled) return;
        setData({ usableProviders: buildUsableProviders(), loading: false });

        const refreshable = activeStates
          .map((state) => {
            const cred = state.credentials;
            const apiKey = cred?.type === 'api_key' ? cred.key : undefined;
            const oauthToken = cred?.type === 'oauth' ? cred.access : undefined;
            return apiKey || oauthToken
              ? { providerId: state.provider.id, apiKey, oauthToken }
              : null;
          })
          .filter((entry) => entry !== null);

        // Active providers with no credential at all are exactly the local
        // no-auth servers (Ollama, LM Studio, llama.cpp, vLLM, SGLang) — they
        // never carry an api_key/oauth credential by design. Those still need
        // live discovery (their models otherwise only appear after a manual
        // /local-models run), just via the dedicated local-discovery entry
        // point rather than the credentialed one above.
        const hasUncredentialedActive = activeStates.some(
          (state) => !state.credentials,
        );

        // Nothing to refresh (no credentialed provider, no local provider
        // active): skip the extra render entirely.
        if (refreshable.length === 0 && !hasUncredentialedActive) return;

        await Promise.all([
          ...refreshable.map(async ({ providerId, apiKey, oauthToken }) => {
            try {
              await modelRegistry.discoverProviderModels(
                providerId,
                apiKey,
                oauthToken,
              );
            } catch {
              // Best-effort refresh; a failed provider keeps its last-known models.
            }
          }),
          ...(hasUncredentialedActive
            ? [
                (async () => {
                  try {
                    await modelRegistry.discoverLocalModels?.();
                  } catch {
                    // Best-effort refresh; a failed local server keeps its last-known models.
                  }
                })(),
              ]
            : []),
        ]);

        if (cancelled) return;
        setData({ usableProviders: buildUsableProviders(), loading: false });
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

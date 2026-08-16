/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type {
  PlumbModel,
  PlumbProvider,
  PlumbProviderAuthState,
} from '@plumb/provider';

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
        const providerPackage = await import('@plumb/provider');
        const registry = providerPackage.getPlumbProviderRegistry();
        const modelRegistry = providerPackage.getPlumbModelRegistry();

        const activeStates = registry.getActiveProviderStates();
        // Re-read the active set on each call rather than closing over the
        // snapshot above: the background pass below can add to it (see the
        // claude-subscription probe), and the second render must reflect
        // that rather than repainting the first snapshot.
        const buildUsableProviders = () =>
          registry
            .getActiveProviderStates()
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

        // Claude Subscription holds no PLUMB-side credential (the Agent SDK
        // owns its auth), so registry.initialize() -- which rebuilds the
        // active set from the credential store -- can never restore it on a
        // cold start. Without this probe it silently vanished from /model
        // whenever it wasn't also the selected provider (switch to Copilot,
        // reopen /model, and a perfectly valid Claude sign-in was gone),
        // while every other signed-in provider persisted.
        //
        // Runs in the background pass rather than before the first render:
        // it shells out to the official Claude CLI, and blocking the dialog
        // on a subprocess to list models the user may not even be switching
        // to is the wrong trade.
        const claudeAlreadyActive = activeStates.some(
          (state) => state.provider.id === 'claude-subscription',
        );
        const probeClaudeSubscription = async () => {
          if (claudeAlreadyActive) return true;
          try {
            const status = await providerPackage.getClaudeSubscriptionStatus();
            if (status.status !== 'CONNECTED_SUBSCRIPTION') return false;
            registry.markProviderActiveWithoutCredential('claude-subscription');
            return true;
          } catch {
            // Best-effort: a failed probe just leaves it out of this listing.
            return false;
          }
        };

        await Promise.all([
          probeClaudeSubscription().then(async (isConnected) => {
            // Discovery is account/plan-aware (Query.supportedModels()), so
            // a stale snapshot from an earlier process/account must never be
            // the only thing model-select shows. The Agent SDK never
            // receives PLUMB credentials, so this is a bare providerId.
            if (!isConnected) return;
            try {
              await modelRegistry.discoverProviderModels('claude-subscription');
            } catch {
              // Non-fatal: keeps its last-known models.
            }
          }),
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

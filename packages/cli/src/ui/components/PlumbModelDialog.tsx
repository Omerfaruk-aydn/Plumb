/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useContext, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import {
  PlumbProviderCategory,
  resolveAutoModel,
  type PlumbModel,
} from '@plumb/provider';
import { AuthType, debugLogger } from '@plumb/core';
import { useKeypress } from '../hooks/useKeypress.js';
import { theme } from '../semantic-colors.js';
import { DescriptiveRadioButtonSelect } from './shared/DescriptiveRadioButtonSelect.js';
import { SearchableModelPicker } from './SearchableModelPicker.js';
import { ConfigContext } from '../contexts/ConfigContext.js';
import { useSettings } from '../contexts/SettingsContext.js';
import {
  SettingScope,
  savePlumbProviderModel,
  readPlumbProviderModels,
} from '../../config/settings.js';
import {
  useModelDialogData,
  type ModelDialogProviderEntry,
} from '../hooks/useModelDialogData.js';

interface PlumbModelDialogProps {
  onClose: () => void;
}

function statusLabelFor(entry: ModelDialogProviderEntry): string {
  switch (entry.provider.category) {
    case PlumbProviderCategory.API_KEY:
      return 'API key configured';
    case PlumbProviderCategory.LOCAL:
      return 'Local available';
    case PlumbProviderCategory.CUSTOM_ENDPOINT:
      return 'Custom configured';
    case PlumbProviderCategory.CODING_PLAN:
    case PlumbProviderCategory.OAUTH_ACCOUNT:
    default:
      return 'Connected';
  }
}

type View = 'providers' | 'models';

export function PlumbModelDialog({
  onClose,
}: PlumbModelDialogProps): React.JSX.Element {
  const config = useContext(ConfigContext);
  const settings = useSettings();
  const { usableProviders, loading } = useModelDialogData(true);

  const [view, setView] = useState<View>('providers');
  const [selectedEntry, setSelectedEntry] =
    useState<ModelDialogProviderEntry | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeProviderId = config?.getPlumbProvider() ?? null;

  const applySelection = useCallback(
    async (providerId: string, modelId: string) => {
      if (!config) {
        onClose();
        return;
      }
      setApplying(true);
      setError(null);
      try {
        config.setModel(modelId, true);
        config.setPlumbProvider(providerId);
        settings.setValue(SettingScope.User, 'plumb.provider.id', providerId);
        savePlumbProviderModel(settings, providerId, modelId);

        // Pre-warm the universal tokenLimit() resolver for this exact
        // model id BEFORE the chat turn runs. Without this, the bottom
        // status row can show a stale limit (e.g. 128K) for any model
        // whose real contextWindow has not yet been recorded into
        // packages/core's per-model cache (see tokenLimits.ts).
        // recordPlumbModelContextWindow() is a no-op for non-positive or
        // missing values, so this is safe even when the registry has no
        // real number for the id.
        try {
          const providerPkg = await import('@plumb/provider');
          const registry = providerPkg.getPlumbModelRegistry?.();
          const plumbModel = registry?.findModel(providerId, modelId);
          if (plumbModel) {
            const core = await import('@plumb/core');
            const rec = (core as Record<string, unknown>)[
              'recordPlumbModelContextWindow'
            ];
            if (typeof rec === 'function') {
              rec.call(null, plumbModel.id, plumbModel.contextWindow);
            }

            // Pre-warm the tool-capability authority BEFORE refreshAuth()
            // rebuilds the chat/system-prompt below, so the very first turn
            // on the newly selected model already gates tool-use prompt
            // instructions correctly instead of relying on the
            // content-generator to self-correct on turn 2 (see
            // Config.setActiveModelToolsCapability).
            config.setActiveModelToolsCapability(
              (plumbModel as { toolsSupported?: boolean }).toolsSupported,
              (plumbModel as { toolsCapabilitySource?: string })
                .toolsCapabilitySource ?? 'UNKNOWN',
            );
          }
        } catch {
          // Non-fatal: chat turn below will record the value anyway.
        }

        // PLUMB_PROVIDER content generators bind provider+model at
        // construction time (see contentGenerator.ts) — a live switch must
        // rebuild it via refreshAuth, the same call
        // handleProviderSetupComplete makes after initial setup. Credential
        // resolution for an already-connected provider happens from the
        // credential store at stream time, so no literal apiKey is passed.
        await config.refreshAuth(AuthType.PLUMB_PROVIDER);
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        debugLogger.warn(`Model switch failed: ${message}`);
        setError(message);
        setApplying(false);
      }
    },
    [config, settings, onClose],
  );

  const providerItems = useMemo(
    () => [
      {
        key: 'auto',
        value: 'auto',
        title: 'Auto',
        description: 'Let PLUMB choose among available connected models',
      },
      ...usableProviders.map((entry) => ({
        key: entry.provider.id,
        value: entry.provider.id,
        title: entry.provider.name,
        description: `${statusLabelFor(entry)} · ${entry.models.length} model${
          entry.models.length === 1 ? '' : 's'
        }`,
      })),
    ],
    [usableProviders],
  );

  const handleProviderPick = useCallback(
    (value: string) => {
      if (value === 'auto') {
        const selection = resolveAutoModel(
          usableProviders.map((e) => ({
            provider: e.provider,
            models: e.models,
          })),
          activeProviderId,
        );
        if (!selection) {
          setError('No connected providers available for Auto.');
          return;
        }
        void applySelection(selection.providerId, selection.modelId);
        return;
      }
      const entry = usableProviders.find((e) => e.provider.id === value);
      if (!entry) return;
      setSelectedEntry(entry);
      setView('models');
    },
    [usableProviders, activeProviderId, applySelection],
  );

  const rememberedModels = readPlumbProviderModels(settings);
  const initialSelectedId = selectedEntry
    ? rememberedModels[selectedEntry.provider.id]
    : undefined;

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (view === 'models') {
          setView('providers');
          setSelectedEntry(null);
          return true;
        }
        onClose();
        return true;
      }
      // Ctrl+R: force-refresh the model list (re-runs live discovery for
      // every active provider, including claude-subscription's
      // account/plan-aware `Query.supportedModels()`). Without this key,
      // a stale on-disk cache (or a successful re-auth above that
      // invalidated the cache) is invisible to the user until they
      // close/reopen the dialog.
      if (key.ctrl === true && (key.name === 'r' || key.name === 'R')) {
        // Trigger a re-run by toggling the hook's isOpen state. Easiest
        // way: remount the hook by changing nothing about the prop
        // (it stays `true`) but force a re-discovery through the
        // registry directly — useModelDialogData has its own background
        // refresh path so just re-invoking refresh keeps the dialog
        // UX consistent with what users see on first open.
        try {
          void import('@plumb/provider').then((m) =>
            m
              .getPlumbModelRegistry?.()
              ?.refreshProvider?.('claude-subscription'),
          );
        } catch {
          // Best-effort: ignored.
        }
        return true;
      }
      return false;
    },
    { isActive: view === 'providers' || view === 'models' },
  );

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>Select Model</Text>

      {error && (
        <Box marginTop={1}>
          <Text color={theme.status.error}>Error: {error}</Text>
        </Box>
      )}

      {applying && (
        <Box marginTop={1}>
          <Text color={theme.status.warning}>Switching model...</Text>
        </Box>
      )}

      {!applying && view === 'providers' && (
        <Box marginTop={1} flexDirection="column">
          {loading && usableProviders.length === 0 ? (
            <Text dimColor>Loading connected providers...</Text>
          ) : (
            <DescriptiveRadioButtonSelect
              items={providerItems}
              onSelect={handleProviderPick}
              showNumbers={true}
            />
          )}
          <Box marginTop={1}>
            <Text dimColor>(Press Esc to close)</Text>
          </Box>
        </Box>
      )}

      {!applying && view === 'models' && selectedEntry && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>
            {selectedEntry.provider.name} — {selectedEntry.models.length} model
            {selectedEntry.models.length === 1 ? '' : 's'}
          </Text>
          <SearchableModelPicker
            models={selectedEntry.models}
            initialSelectedId={initialSelectedId}
            onSelect={(model: PlumbModel) =>
              void applySelection(selectedEntry.provider.id, model.id)
            }
            onCancel={() => {
              setView('providers');
              setSelectedEntry(null);
            }}
          />
        </Box>
      )}
    </Box>
  );
}

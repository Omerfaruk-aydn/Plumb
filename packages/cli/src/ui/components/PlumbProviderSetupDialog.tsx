/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
/* eslint-disable @typescript-eslint/no-unused-vars */

import type React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { Box, Text } from 'ink';
import {
  PlumbProviderCategory,
  type PlumbProvider,
} from '@google/gemini-cli-provider';

// ─── Steps ─────────────────────────────────────────────────────────────

type SetupStep =
  | 'connection-type'
  | 'provider-select'
  | 'authenticate'
  | 'model-select'
  | 'confirm'
  | 'done';

interface SetupState {
  step: SetupStep;
  category: PlumbProviderCategory | null;
  selectedProvider: PlumbProvider | null;
  apiKey: string;
  selectedModel: string | null;
  smolModel: string | null;
  planningModel: string | null;
  error: string | null;
  loading: boolean;
}

// ─── Props ─────────────────────────────────────────────────────────────

export interface PlumbProviderSetupDialogProps {
  onComplete: (config: PlumbProviderSetupResult) => void;
  onCancel: () => void;
  providers: PlumbProvider[];
  categoryGroups: Map<string, PlumbProvider[]>;
  models: Array<{ id: string; name?: string; provider: string }>;
}

export interface PlumbProviderSetupResult {
  providerId: string;
  modelId: string;
  apiKey?: string;
  smolModel?: string;
  planningModel?: string;
}

// ─── Connection type picker ────────────────────────────────────────────

const CONNECTION_TYPES = [
  {
    key: PlumbProviderCategory.CODING_PLAN,
    label: 'Coding Plan / Subscription',
    description: 'ChatGPT Plus/Pro, GitHub Copilot, Cursor, Kimi Code, etc.',
  },
  {
    key: PlumbProviderCategory.OAUTH_ACCOUNT,
    label: 'OAuth Account',
    description: 'Sign in with your provider account (Anthropic, xAI, etc.)',
  },
  {
    key: PlumbProviderCategory.API_KEY,
    label: 'API Key Provider',
    description: 'OpenAI, Google Gemini, DeepSeek, OpenRouter, Mistral, etc.',
  },
  {
    key: PlumbProviderCategory.LOCAL,
    label: 'Local / Keyless Model',
    description: 'Ollama, LM Studio, llama.cpp, vLLM',
  },
  {
    key: PlumbProviderCategory.CUSTOM_ENDPOINT,
    label: 'Custom Endpoint',
    description: 'Any OpenAI-compatible API endpoint',
  },
];

// ─── Component ─────────────────────────────────────────────────────────

export const PlumbProviderSetupDialog: React.FC<
  PlumbProviderSetupDialogProps
> = ({ onComplete, onCancel, providers, categoryGroups, models }) => {
  const [state, setState] = useState<SetupState>({
    step: 'connection-type',
    category: null,
    selectedProvider: null,
    apiKey: '',
    selectedModel: null,
    smolModel: null,
    planningModel: null,
    error: null,
    loading: false,
  });

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [apiKeyInput, setApiKeyInput] = useState('');

  const connectionTypeOptions = CONNECTION_TYPES;
  const categoryProviders = state.category
    ? (categoryGroups.get(
        [...categoryGroups.entries()].find(
          ([, ps]) => ps[0]?.category === state.category,
        )?.[0] ?? '',
      ) ?? providers.filter((p) => p.category === state.category))
    : [];
  const providerModels = state.selectedProvider
    ? models.filter((m) => m.provider === state.selectedProvider!.id)
    : [];

  const handleConnectionTypeSelect = useCallback(
    (category: PlumbProviderCategory) => {
      setState((s) => ({
        ...s,
        step: 'provider-select',
        category,
        error: null,
      }));
      setSelectedIndex(0);
    },
    [],
  );

  const handleProviderSelect = useCallback(async (provider: PlumbProvider) => {
    setState((s) => ({
      ...s,
      step: 'authenticate',
      selectedProvider: provider,
      error: null,
      loading: false,
    }));
    setApiKeyInput('');

    // Auto-skip auth for local/keyless providers
    if (provider.allowUnauthenticated) {
      setState((s) => ({
        ...s,
        step: 'model-select',
        selectedProvider: provider,
      }));
    }
  }, []);

  const handleApiKeySubmit = useCallback((key: string) => {
    setState((s) => ({
      ...s,
      step: 'model-select',
      apiKey: key.trim(),
      error: null,
    }));
    setSelectedIndex(0);
  }, []);

  const handleModelSelect = useCallback((modelId: string) => {
    setState((s) => ({ ...s, step: 'confirm', selectedModel: modelId }));
    setSelectedIndex(0);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!state.selectedProvider || !state.selectedModel) return;
    onComplete({
      providerId: state.selectedProvider.id,
      modelId: state.selectedModel,
      apiKey: state.apiKey || undefined,
      smolModel: state.smolModel ?? undefined,
      planningModel: state.planningModel ?? undefined,
    });
  }, [state, onComplete]);

  // ── Render step ─────────────────────────────────────────────────────

  const step = state.step;
  const provider = state.selectedProvider;

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="round"
      borderColor="cyan"
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          PLUMB Provider Setup
        </Text>
        {step !== 'connection-type' && (
          <Text dimColor> — Step {getStepNumber(step)} of 5</Text>
        )}
      </Box>

      {/* Error display */}
      {state.error && (
        <Box marginBottom={1}>
          <Text color="red">Error: {state.error}</Text>
        </Box>
      )}

      {/* Loading */}
      {state.loading && (
        <Box marginBottom={1}>
          <Text color="yellow">Loading...</Text>
        </Box>
      )}

      {/* Step content */}
      {step === 'connection-type' && (
        <ConnectionTypePicker
          options={connectionTypeOptions}
          selectedIndex={selectedIndex}
          onSelect={handleConnectionTypeSelect}
          onNavigate={setSelectedIndex}
        />
      )}

      {step === 'provider-select' && (
        <ProviderPicker
          providers={categoryProviders}
          selectedIndex={selectedIndex}
          onSelect={handleProviderSelect}
          onNavigate={setSelectedIndex}
          onBack={() =>
            setState((s) => ({ ...s, step: 'connection-type', category: null }))
          }
        />
      )}

      {step === 'authenticate' && provider && (
        <AuthStep
          provider={provider}
          apiKeyInput={apiKeyInput}
          onApiKeyChange={setApiKeyInput}
          onSubmit={handleApiKeySubmit}
          onBack={() =>
            setState((s) => ({
              ...s,
              step: 'provider-select',
              selectedProvider: null,
            }))
          }
        />
      )}

      {step === 'model-select' && provider && (
        <ModelPicker
          models={providerModels}
          selectedIndex={selectedIndex}
          onSelect={handleModelSelect}
          onNavigate={setSelectedIndex}
          onBack={() =>
            setState((s) => ({
              ...s,
              step: provider.allowUnauthenticated
                ? 'provider-select'
                : 'authenticate',
            }))
          }
        />
      )}

      {step === 'confirm' && provider && state.selectedModel && (
        <ConfirmStep
          provider={provider}
          modelId={state.selectedModel}
          onConfirm={handleConfirm}
          onBack={() =>
            setState((s) => ({
              ...s,
              step: 'model-select',
              selectedModel: null,
            }))
          }
        />
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>ESC to cancel • ↑↓ to navigate • Enter to select</Text>
      </Box>
    </Box>
  );
};

// ─── Sub-components ─────────────────────────────────────────────────────

function ConnectionTypePicker({
  options,
  selectedIndex,
  onSelect,
  onNavigate,
}: {
  options: Array<{
    key: PlumbProviderCategory;
    label: string;
    description: string;
  }>;
  selectedIndex: number;
  onSelect: (category: PlumbProviderCategory) => void;
  onNavigate: (index: number) => void;
}) {
  return (
    <Box flexDirection="column">
      <Text bold>Choose connection type:</Text>
      <Box flexDirection="column" marginY={1}>
        {options.map((opt, i) => (
          <Box key={opt.key}>
            <Text color={i === selectedIndex ? 'cyan' : undefined}>
              {i === selectedIndex ? '▶ ' : '  '}
              {opt.label}
            </Text>
            {i === selectedIndex && <Text dimColor> — {opt.description}</Text>}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function ProviderPicker({
  providers,
  selectedIndex,
  onSelect,
  onNavigate,
  onBack,
}: {
  providers: PlumbProvider[];
  selectedIndex: number;
  onSelect: (provider: PlumbProvider) => void;
  onNavigate: (index: number) => void;
  onBack: () => void;
}) {
  if (providers.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No providers available in this category.</Text>
        <Text dimColor>Press Backspace to go back.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Choose provider:</Text>
      <Box flexDirection="column" marginY={1}>
        {providers.map((p, i) => (
          <Box key={p.id}>
            <Text color={i === selectedIndex ? 'cyan' : undefined}>
              {i === selectedIndex ? '▶ ' : '  '}
              {p.name}
            </Text>
            {i === selectedIndex && p.description && (
              <Text dimColor> — {p.description}</Text>
            )}
          </Box>
        ))}
      </Box>
      <Text dimColor>Backspace: back to connection types</Text>
    </Box>
  );
}

function AuthStep({
  provider,
  apiKeyInput,
  onApiKeyChange,
  onSubmit,
  onBack,
}: {
  provider: PlumbProvider;
  apiKeyInput: string;
  onApiKeyChange: (value: string) => void;
  onSubmit: (key: string) => void;
  onBack: () => void;
}) {
  const hasOAuth = provider.authMethods.some((m) => m.type === 'oauth');
  const hasApiKey = provider.authMethods.some((m) => m.type === 'api_key');
  const hasEnv = provider.authMethods.some((m) => m.type === 'env');

  return (
    <Box flexDirection="column">
      <Text bold>Authenticate: {provider.name}</Text>
      <Box flexDirection="column" marginY={1}>
        {hasOAuth && (
          <Box marginBottom={1}>
            <Text>
              OAuth login will open your browser to sign in with {provider.name}
              .
            </Text>
          </Box>
        )}
        {hasApiKey && (
          <Box flexDirection="column" marginBottom={1}>
            <Text>Enter your API key for {provider.name}:</Text>
            {provider.envVars && provider.envVars.length > 0 && (
              <Text dimColor>
                Or set {provider.envVars.join(' / ')} environment variable.
              </Text>
            )}
          </Box>
        )}
        {hasEnv && (
          <Box marginBottom={1}>
            <Text>
              Required environment variables:{' '}
              {provider.authMethods
                .filter((m) => m.type === 'env')
                .flatMap((m) =>
                  'envVars' in m ? (m as { envVars: string[] }).envVars : [],
                )
                .join(', ')}
            </Text>
          </Box>
        )}
      </Box>
      <Box>
        <Text dimColor>
          Type API key and press Enter, or press Backspace to choose a different
          provider.
        </Text>
      </Box>
    </Box>
  );
}

function ModelPicker({
  models,
  selectedIndex,
  onSelect,
  onNavigate,
  onBack,
}: {
  models: Array<{ id: string; name?: string; provider: string }>;
  selectedIndex: number;
  onSelect: (modelId: string) => void;
  onNavigate: (index: number) => void;
  onBack: () => void;
}) {
  if (models.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No bundled models for this provider.</Text>
        <Text>You can type a custom model ID later.</Text>
        <Text dimColor>Press Backspace to go back.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Choose model:</Text>
      <Box flexDirection="column" marginY={1}>
        {models.map((m, i) => (
          <Box key={m.id}>
            <Text color={i === selectedIndex ? 'cyan' : undefined}>
              {i === selectedIndex ? '▶ ' : '  '}
              {m.name ?? m.id}
            </Text>
            {i === selectedIndex && <Text dimColor> — {m.provider}</Text>}
          </Box>
        ))}
      </Box>
      <Text dimColor>Backspace: back to authentication</Text>
    </Box>
  );
}

function ConfirmStep({
  provider,
  modelId,
  onConfirm,
  onBack,
}: {
  provider: PlumbProvider;
  modelId: string;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <Box flexDirection="column">
      <Text bold>Confirm setup:</Text>
      <Box flexDirection="column" marginY={1}>
        <Text>
          Provider: <Text color="green">{provider.name}</Text>
        </Text>
        <Text>
          Model: <Text color="green">{modelId}</Text>
        </Text>
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>Press Enter to confirm and start PLUMB.</Text>
        <Text dimColor>Press Backspace to choose a different model.</Text>
      </Box>
    </Box>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function getStepNumber(step: SetupStep): number {
  switch (step) {
    case 'connection-type':
      return 1;
    case 'provider-select':
      return 2;
    case 'authenticate':
      return 3;
    case 'model-select':
      return 4;
    case 'confirm':
      return 5;
    default:
      return 1;
  }
}

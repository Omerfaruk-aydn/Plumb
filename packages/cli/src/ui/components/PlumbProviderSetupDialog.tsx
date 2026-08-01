/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import {
  PlumbProviderCategory,
  type PlumbProvider,
} from '@google/gemini-cli-provider';
import { useKeypress } from '../hooks/useKeypress.js';
import { DescriptiveRadioButtonSelect } from './shared/DescriptiveRadioButtonSelect.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';

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

  const [apiKeyInput, setApiKeyInput] = useState('');

  const categoryProviders = useMemo(() => {
    if (!state.category) return [];
    return (
      categoryGroups.get(
        [...categoryGroups.entries()].find(
          ([, ps]) => ps[0]?.category === state.category,
        )?.[0] ?? '',
      ) ?? providers.filter((p) => p.category === state.category)
    );
  }, [state.category, categoryGroups, providers]);

  const providerModels = useMemo(() => {
    if (!state.selectedProvider) return [];
    return models.filter((m) => m.provider === state.selectedProvider!.id);
  }, [state.selectedProvider, models]);

  const connectionTypeItems = useMemo(
    () =>
      CONNECTION_TYPES.map((opt) => ({
        key: opt.key,
        value: opt.key,
        title: opt.label,
        description: opt.description,
      })),
    [],
  );

  const providerItems = useMemo(
    () =>
      categoryProviders.map((p) => ({
        key: p.id,
        value: p,
        label: p.name,
        sublabel: p.description,
      })),
    [categoryProviders],
  );

  const modelItems = useMemo(
    () =>
      providerModels.map((m) => ({
        key: m.id,
        value: m.id,
        label: m.name ?? m.id,
        sublabel: m.provider,
      })),
    [providerModels],
  );

  const handleConnectionTypeSelect = useCallback(
    (category: PlumbProviderCategory) => {
      setState((s) => ({
        ...s,
        step: 'provider-select',
        category,
        error: null,
      }));
    },
    [],
  );

  const handleProviderSelect = useCallback((provider: PlumbProvider) => {
    setApiKeyInput('');
    setState((s) => ({
      ...s,
      step: provider.allowUnauthenticated ? 'model-select' : 'authenticate',
      selectedProvider: provider,
      error: null,
      loading: false,
    }));
  }, []);

  const handleApiKeySubmit = useCallback((key: string) => {
    setState((s) => ({
      ...s,
      step: 'model-select',
      apiKey: key.trim(),
      error: null,
    }));
  }, []);

  const handleModelSelect = useCallback((modelId: string) => {
    setState((s) => ({ ...s, step: 'confirm', selectedModel: modelId }));
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

  // Keyboard handling for authenticate/confirm steps and global navigation
  const step = state.step;
  const provider = state.selectedProvider;

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onCancel();
        return true;
      }

      if (step === 'authenticate') {
        if (key.name === 'enter') {
          handleApiKeySubmit(apiKeyInput);
          return true;
        }
        if (key.name === 'backspace') {
          if (apiKeyInput.length === 0) {
            setState((s) => ({
              ...s,
              step: 'provider-select',
              selectedProvider: null,
            }));
          } else {
            setApiKeyInput((prev) => prev.slice(0, -1));
          }
          return true;
        }
        if (
          key.insertable &&
          key.sequence &&
          !key.ctrl &&
          !key.alt &&
          !key.cmd
        ) {
          setApiKeyInput((prev) => prev + key.sequence);
          return true;
        }
        return true;
      }

      if (step === 'confirm') {
        if (key.name === 'enter') {
          handleConfirm();
          return true;
        }
        if (key.name === 'backspace') {
          setState((s) => ({
            ...s,
            step: 'model-select',
            selectedModel: null,
          }));
          return true;
        }
        return true;
      }

      // Backspace navigation for list steps
      if (key.name === 'backspace') {
        if (step === 'provider-select') {
          setState((s) => ({ ...s, step: 'connection-type', category: null }));
        } else if (step === 'model-select') {
          setState((s) => ({
            ...s,
            step: provider?.allowUnauthenticated
              ? 'provider-select'
              : 'authenticate',
          }));
        }
        return true;
      }

      return false;
    },
    { isActive: true },
  );

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="round"
      borderColor="cyan"
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          PLUMB Provider Setup
        </Text>
        {step !== 'connection-type' && (
          <Text dimColor> — Step {getStepNumber(step)} of 5</Text>
        )}
      </Box>

      {state.error && (
        <Box marginBottom={1}>
          <Text color="red">Error: {state.error}</Text>
        </Box>
      )}

      {state.loading && (
        <Box marginBottom={1}>
          <Text color="yellow">Loading...</Text>
        </Box>
      )}

      {step === 'connection-type' && (
        <DescriptiveRadioButtonSelect
          items={connectionTypeItems}
          onSelect={handleConnectionTypeSelect}
          isFocused={true}
          showNumbers={false}
        />
      )}

      {step === 'provider-select' && (
        <>
          <Text bold>Choose provider:</Text>
          {providerItems.length === 0 ? (
            <Box flexDirection="column">
              <Text dimColor>No providers available in this category.</Text>
              <Text dimColor>Press Backspace to go back.</Text>
            </Box>
          ) : (
            <RadioButtonSelect
              items={providerItems}
              onSelect={handleProviderSelect}
              isFocused={true}
              showNumbers={false}
            />
          )}
          <Box marginTop={1}>
            <Text dimColor>Backspace: back to connection types</Text>
          </Box>
        </>
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
        <>
          <Text bold>Choose model:</Text>
          {modelItems.length === 0 ? (
            <Box flexDirection="column">
              <Text dimColor>No bundled models for this provider.</Text>
              <Text>You can type a custom model ID later.</Text>
              <Text dimColor>Press Backspace to go back.</Text>
            </Box>
          ) : (
            <RadioButtonSelect
              items={modelItems}
              onSelect={handleModelSelect}
              isFocused={true}
              showNumbers={false}
            />
          )}
          <Box marginTop={1}>
            <Text dimColor>Backspace: back to authentication</Text>
          </Box>
        </>
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

      <Box marginTop={1}>
        <Text dimColor>ESC to cancel • ↑↓ to navigate • Enter to select</Text>
      </Box>
    </Box>
  );
};

function AuthStep({
  provider,
  apiKeyInput,
  onSubmit: _onSubmit,
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
            <Text>
              Key: {'•'.repeat(apiKeyInput.length)}
              <Text dimColor>▌</Text>
            </Text>
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

function ConfirmStep({
  provider,
  modelId,
  onConfirm: _onConfirm,
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

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import {
  PlumbProviderCategory,
  type PlumbProvider,
  type PlumbModel,
  getCatalogModels,
} from '@google/gemini-cli-provider';
import { useKeypress } from '../hooks/useKeypress.js';
import { Command } from '../key/keyMatchers.js';
import { useKeyMatchers } from '../hooks/useKeyMatchers.js';
import {
  InputOwner,
  useInputOwnership,
} from '../contexts/InputOwnershipContext.js';
import { DescriptiveRadioButtonSelect } from './shared/DescriptiveRadioButtonSelect.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { SearchableModelPicker } from './SearchableModelPicker.js';

type SetupStep =
  | 'connection-type'
  | 'provider-select'
  | 'authenticate'
  | 'oauth-waiting'
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
  oauthStatus: string | null;
}

export interface PlumbProviderSetupDialogProps {
  onComplete: (config: PlumbProviderSetupResult) => void;
  onCancel: () => void;
  providers: PlumbProvider[];
  categoryGroups: Map<string, PlumbProvider[]>;
  models: Array<{ id: string; name?: string; provider: string }>;
  fullModels?: PlumbModel[];
  onOAuthLogin?: (
    providerId: string,
  ) => Promise<{ success: boolean; error?: string }>;
  onRefreshModels?: () => Promise<
    Array<{ id: string; name?: string; provider: string }>
  >;
  onRefreshFullModels?: () => Promise<PlumbModel[]>;
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
> = ({
  onComplete,
  onCancel,
  providers,
  categoryGroups,
  models: initialModels,
  fullModels: initialFullModels,
  onOAuthLogin,
  onRefreshModels,
  onRefreshFullModels,
}) => {
  const keyMatchers = useKeyMatchers();
  const { claim } = useInputOwnership();

  // Claim exclusive input ownership while this dialog is mounted.
  // This prevents InputPrompt/Composer from registering or processing
  // any keypresses (Enter, Tab, Escape, etc.) while the dialog is open.
  useEffect(() => {
    const release = claim(InputOwner.PROVIDER_SETUP);
    return release;
  }, [claim]);

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
    oauthStatus: null,
  });
  const [confirmPending, setConfirmPending] = useState(false);

  // PLUMB_KEY_TRACE diagnostic state
  const keyTraceEnabled = !!process.env['PLUMB_KEY_TRACE'];
  const [lastKeyTrace, setLastKeyTrace] = useState<{
    keyName: string;
    returnMatched: boolean;
    consumedBy: string;
  } | null>(null);

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [dynamicModels, setDynamicModels] = useState<
    Array<{ id: string; name?: string; provider: string }>
  >([]);
  const [dynamicFullModels, setDynamicFullModels] = useState<PlumbModel[]>([]);

  const allModels = useMemo(
    () => [...initialModels, ...dynamicModels],
    [initialModels, dynamicModels],
  );

  const allFullModels = useMemo(
    () => [...(initialFullModels ?? []), ...dynamicFullModels],
    [initialFullModels, dynamicFullModels],
  );

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
    // Include both authenticated models and OMP bundled catalog models
    const bundled = getCatalogModels(state.selectedProvider.id);
    const byAuth = allModels.filter(
      (m) => m.provider === state.selectedProvider!.id,
    );
    const ids = new Set(byAuth.map((m) => m.id));
    return [...byAuth, ...bundled.filter((m) => !ids.has(m.id))];
  }, [state.selectedProvider, allModels]);

  const providerFullModels = useMemo(() => {
    if (!state.selectedProvider) return [];
    // Include both authenticated models and OMP bundled catalog models
    const bundled = getCatalogModels(state.selectedProvider.id);
    const byAuth = allFullModels.filter(
      (m) => m.provider === state.selectedProvider!.id,
    );
    const ids = new Set(byAuth.map((m) => m.id));
    return [...byAuth, ...bundled.filter((m) => !ids.has(m.id))];
  }, [state.selectedProvider, allFullModels]);

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
      oauthStatus: null,
    }));
  }, []);

  const handleOAuthStart = useCallback(async () => {
    if (!state.selectedProvider || !onOAuthLogin) return;

    setState((s) => ({
      ...s,
      step: 'oauth-waiting',
      loading: true,
      oauthStatus: 'Opening browser...',
      error: null,
    }));

    try {
      const result = await onOAuthLogin(state.selectedProvider.id);
      if (result.success) {
        // Refresh models after successful auth
        if (onRefreshModels) {
          try {
            const refreshed = await onRefreshModels();
            setDynamicModels(refreshed);
          } catch {
            // Model refresh failure is non-fatal
          }
        }
        setState((s) => ({
          ...s,
          step: 'model-select',
          loading: false,
          oauthStatus: null,
        }));
      } else {
        setState((s) => ({
          ...s,
          step: 'authenticate',
          loading: false,
          oauthStatus: null,
          error: result.error ?? 'OAuth login failed',
        }));
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        step: 'authenticate',
        loading: false,
        oauthStatus: null,
        error: err instanceof Error ? err.message : 'OAuth login failed',
      }));
    }
  }, [state.selectedProvider, onOAuthLogin, onRefreshModels]);

  const handleApiKeySubmit = useCallback(
    async (key: string) => {
      setState((s) => ({
        ...s,
        step: 'model-select',
        apiKey: key.trim(),
        error: null,
      }));
      // Refresh models after API key submission (like OAuth does)
      if (onRefreshModels) {
        try {
          const refreshed = await onRefreshModels();
          setDynamicModels(refreshed);
        } catch {
          // Model refresh failure is non-fatal
        }
      }
      if (onRefreshFullModels) {
        try {
          const refreshed = await onRefreshFullModels();
          setDynamicFullModels(refreshed);
        } catch {
          // Model refresh failure is non-fatal
        }
      }
    },
    [onRefreshModels, onRefreshFullModels],
  );

  const handleModelSelect = useCallback((modelId: string) => {
    setState((s) => ({ ...s, step: 'confirm', selectedModel: modelId }));
  }, []);

  const handleConfirm = useCallback(() => {
    if (confirmPending) return;
    if (!state.selectedProvider || !state.selectedModel) return;
    setConfirmPending(true);
    setState((s) => ({ ...s, error: null }));
    try {
      onComplete({
        providerId: state.selectedProvider.id,
        modelId: state.selectedModel,
        apiKey: state.apiKey || undefined,
        smolModel: state.smolModel ?? undefined,
        planningModel: state.planningModel ?? undefined,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : 'Setup failed',
      }));
      setConfirmPending(false);
    }
  }, [state, onComplete, confirmPending]);

  // Keyboard handling for authenticate/confirm steps and global navigation
  const step = state.step;
  const provider = state.selectedProvider;

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        // Explicit cancellation destinations — never leave the PLUMB setup
        // graph for the legacy Gemini AuthDialog.
        if (step === 'oauth-waiting') {
          setState((s) => ({
            ...s,
            step: 'authenticate',
            loading: false,
            oauthStatus: null,
            error: null,
          }));
          return true;
        }
        if (step === 'authenticate') {
          setState((s) => ({
            ...s,
            step: 'provider-select',
            selectedProvider: null,
            apiKey: '',
            error: null,
          }));
          setApiKeyInput('');
          return true;
        }
        if (step === 'confirm') {
          setState((s) => ({
            ...s,
            step: 'model-select',
            selectedModel: null,
          }));
          return true;
        }
        if (step === 'model-select') {
          setState((s) => ({
            ...s,
            step: provider?.allowUnauthenticated
              ? 'provider-select'
              : 'authenticate',
            selectedModel: null,
            ...(provider?.allowUnauthenticated
              ? { selectedProvider: null }
              : {}),
          }));
          return true;
        }
        if (step === 'provider-select') {
          setState((s) => ({
            ...s,
            step: 'connection-type',
            category: null,
            selectedProvider: null,
          }));
          return true;
        }
        // connection-type root: close PLUMB setup (chat/welcome shell).
        onCancel();
        return true;
      }

      if (step === 'authenticate') {
        // API-key takes priority when the user has typed a key — never start
        // OAuth waiting for an api_key completion path.
        if (keyMatchers[Command.RETURN](key) && apiKeyInput.length > 0) {
          const isApiKeyProvider = provider?.authMethods.some(
            (m) => m.type === 'api_key',
          );
          if (
            isApiKeyProvider ||
            !provider?.authMethods.some((m) => m.type === 'oauth')
          ) {
            void handleApiKeySubmit(apiKeyInput);
            return true;
          }
        }
        // OAuth / device-code only when no API key was typed
        if (
          keyMatchers[Command.RETURN](key) &&
          apiKeyInput.length === 0 &&
          provider?.authMethods.some(
            (m) => m.type === 'oauth' || m.type === 'device_code',
          ) &&
          onOAuthLogin
        ) {
          void handleOAuthStart();
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

      if (step === 'oauth-waiting') {
        return true;
      }

      if (step === 'confirm') {
        const returnMatched = keyMatchers[Command.RETURN](key);
        if (keyTraceEnabled) {
          setLastKeyTrace({
            keyName: key.name,
            returnMatched,
            consumedBy: 'PlumbProviderSetupDialog',
          });
          process.stderr.write(
            `[KEY_TRACE] confirm step | key.name=${key.name} key.sequence=${JSON.stringify(key.sequence)} Command.RETURN=${returnMatched} confirmPending=${confirmPending}\n`,
          );
        }
        if (returnMatched) {
          void handleConfirm();
          return true;
        }
        if (keyMatchers[Command.ESCAPE](key)) {
          setState((s) => ({
            ...s,
            step: 'model-select',
            selectedModel: null,
          }));
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

      // Backspace navigation for list steps (not model-select, handled by picker)
      if (key.name === 'backspace' && step !== 'model-select') {
        if (step === 'provider-select') {
          setState((s) => ({ ...s, step: 'connection-type', category: null }));
        }
        return true;
      }

      return false;
    },
    { isActive: true, priority: true },
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
          <Text color="yellow">{state.oauthStatus ?? 'Loading...'}</Text>
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
          onOAuthStart={onOAuthLogin ? handleOAuthStart : undefined}
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

      {step === 'oauth-waiting' && (
        <Box flexDirection="column">
          <Text bold color="cyan">
            Waiting for authorization...
          </Text>
          <Box marginY={1}>
            <Text>
              A browser window has been opened. Please sign in with your{' '}
              {provider?.name} account.
            </Text>
          </Box>
          <Text dimColor>Press ESC to cancel</Text>
        </Box>
      )}

      {step === 'model-select' && provider && (
        <>
          {providerFullModels.length > 0 ? (
            <SearchableModelPicker
              models={providerFullModels}
              onSelect={(model: PlumbModel) => handleModelSelect(model.id)}
              onCancel={() =>
                setState((s) => ({
                  ...s,
                  step: provider?.allowUnauthenticated
                    ? 'provider-select'
                    : 'authenticate',
                }))
              }
              onRefresh={
                onRefreshFullModels
                  ? async () => {
                      const refreshed = await onRefreshFullModels();
                      setDynamicFullModels(refreshed);
                    }
                  : undefined
              }
            />
          ) : modelItems.length > 0 ? (
            <>
              <Text bold>Choose model:</Text>
              <RadioButtonSelect
                items={modelItems}
                onSelect={handleModelSelect}
                isFocused={true}
                showNumbers={false}
              />
              <Box marginTop={1}>
                <Text dimColor>Backspace: back to authentication</Text>
              </Box>
            </>
          ) : (
            <Box flexDirection="column">
              <Text dimColor>No models available for this provider.</Text>
              <Text dimColor>Press Backspace to go back.</Text>
            </Box>
          )}
        </>
      )}

      {step === 'confirm' && provider && state.selectedModel && (
        <Box flexDirection="column">
          <Text bold>Confirm setup:</Text>
          <Box flexDirection="column" marginY={1}>
            <Text>
              Provider: <Text color="green">{provider.name}</Text>
            </Text>
            <Text>
              Model: <Text color="green">{state.selectedModel}</Text>
            </Text>
          </Box>
          <Box marginBottom={1}>
            <Text color="cyan">Press Enter to confirm and start PLUMB.</Text>
            <Text dimColor>Press Backspace to choose a different model.</Text>
          </Box>
        </Box>
      )}

      {keyTraceEnabled && step === 'confirm' && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="single"
          borderColor="yellow"
          padding={0}
        >
          <Text color="yellow" bold>
            [PLUMB_KEY_TRACE]
          </Text>
          <Text color="yellow">Input owner: {InputOwner.PROVIDER_SETUP}</Text>
          <Text color="yellow">Composer active: false</Text>
          <Text color="yellow">Confirm handler active: true</Text>
          {lastKeyTrace ? (
            <>
              <Text color="yellow">Last key: {lastKeyTrace.keyName}</Text>
              <Text color="yellow">
                RETURN matched: {String(lastKeyTrace.returnMatched)}
              </Text>
              <Text color="yellow">Consumed by: {lastKeyTrace.consumedBy}</Text>
            </>
          ) : (
            <Text dimColor>(no key received yet)</Text>
          )}
        </Box>
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
  onOAuthStart,
  onSubmit: _onSubmit,
}: {
  provider: PlumbProvider;
  apiKeyInput: string;
  onOAuthStart?: () => void;
  onSubmit: (key: string) => void;
  onBack: () => void;
}) {
  const hasOAuth = provider.authMethods.some((m) => m.type === 'oauth');
  const hasApiKey = provider.authMethods.some((m) => m.type === 'api_key');
  const hasDeviceCode = provider.authMethods.some(
    (m) => m.type === 'device_code',
  );
  const hasEnv = provider.authMethods.some((m) => m.type === 'env');

  return (
    <Box flexDirection="column">
      <Text bold>Authenticate: {provider.name}</Text>
      <Box flexDirection="column" marginY={1}>
        {hasOAuth && onOAuthStart && (
          <Box marginBottom={1}>
            <Text color="cyan">Press Enter to sign in with your browser</Text>
            <Text dimColor>
              This will open {provider.name} in your browser for secure sign-in.
            </Text>
          </Box>
        )}
        {hasOAuth && !onOAuthStart && (
          <Box marginBottom={1}>
            <Text>
              OAuth login will open your browser to sign in with {provider.name}
              .
            </Text>
          </Box>
        )}
        {hasDeviceCode && (
          <Box marginBottom={1}>
            <Text color="cyan">Press Enter to get a device code</Text>
            <Text dimColor>
              You will be given a code to enter on the provider website.
            </Text>
          </Box>
        )}
        {hasApiKey && (
          <Box flexDirection="column" marginBottom={1}>
            <Text>
              {hasOAuth
                ? 'Or enter your API key directly:'
                : 'Enter your API key for ' + provider.name + ':'}
            </Text>
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
          {hasOAuth && onOAuthStart
            ? 'Enter to sign in • Type API key to use directly • Backspace to go back'
            : 'Type API key and press Enter • Backspace to go back'}
        </Text>
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
    case 'oauth-waiting':
      return 3;
    case 'model-select':
      return 4;
    case 'confirm':
      return 5;
    default:
      return 1;
  }
}

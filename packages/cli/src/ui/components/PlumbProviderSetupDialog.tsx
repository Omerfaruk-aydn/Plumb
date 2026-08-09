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
  type PlumbProviderAuthState,
  type ClaudeSubscriptionStatusResult,
  getCatalogModels,
  getCodingPlan,
  getClaudeSubscriptionStatus,
  getPlumbProviderRegistry,
  getGatewayProviderConfigSchema,
  GATEWAY_CONFIG_PROVIDER_IDS,
  getLocalProviderConfigSchema,
  LOCAL_PROVIDER_IDS,
  validateCodingPlanApiKey,
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
import { PlumbCloudProviderConfigForm } from './PlumbCloudProviderConfigForm.js';
import { PlumbGenericCloudConfigForm } from './PlumbGenericCloudConfigForm.js';
import { PlumbAzureCloudConfigForm } from './PlumbAzureCloudConfigForm.js';
import { PlumbCustomProviderManagerScreen } from './PlumbCustomProviderManagerScreen.js';
import { createCustomProviderConfigActions } from '../utils/customProviderConfigActions.js';
import {
  BEDROCK_CONFIG_SCHEMA,
  VERTEX_CONFIG_SCHEMA,
  WATSONX_CONFIG_SCHEMA,
} from '@google/gemini-cli-provider';
import { bedrockCloudConfigActions } from '../utils/bedrockCloudConfigActions.js';
import { vertexCloudConfigActions } from '../utils/vertexCloudConfigActions.js';
import { watsonxCloudConfigActions } from '../utils/watsonxCloudConfigActions.js';
import { getLocalProviderConfigActions } from '../utils/localProviderConfigActions.js';
import { getGatewayProviderConfigActions } from '../utils/gatewayProviderConfigActions.js';

type SetupStep =
  | 'connection-type'
  | 'provider-select'
  | 'connected'
  | 'authenticate'
  | 'oauth-waiting'
  | 'cloud-config'
  | 'manage-custom-providers'
  | 'model-select'
  | 'confirm'
  | 'done';

/**
 * Sentinel entry injected into the Custom Endpoint provider list. Selecting
 * it opens the CRUD manager instead of trying to configure a real provider
 * -- it is never itself a routable providerId (the `custom:<uuid>` pattern
 * cannot collide with it).
 */
const MANAGE_CUSTOM_PROVIDERS_ID = '__manage_custom_providers__';

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
  // Real connection state for the currently selected provider, read from the
  // canonical PlumbProviderRegistry — never a UI-only boolean. Populated when
  // handleProviderSelect finds an existing 'authenticated'/'expired' state,
  // so the dialog can offer Continue/Re-authenticate/Logout instead of
  // silently restarting device-code login on an already-connected provider.
  connectionAuthState: PlumbProviderAuthState | null;
}

const CLAUDE_SUBSCRIPTION_PROVIDER_ID = 'claude-subscription';

/**
 * Providers whose setup goes through a rich cloud-configuration form
 * instead of the generic single-secret 'authenticate' step. OCI keeps its
 * own bespoke form (IAM-subtype nested select, OCID validation); Bedrock/
 * Vertex/watsonx share PlumbGenericCloudConfigForm (flat schema-driven);
 * Azure gets its own form (first-class deployment-list management).
 */
const CLOUD_CONFIGURATION_PROVIDER_IDS: ReadonlySet<string> = new Set([
  'oci-genai',
  'amazon-bedrock',
  'google-vertex',
  'watsonx',
  'azure',
]);

const LOCAL_CONFIGURATION_PROVIDER_IDS: ReadonlySet<string> = new Set(
  LOCAL_PROVIDER_IDS,
);
const GATEWAY_CONFIGURATION_PROVIDER_IDS: ReadonlySet<string> = new Set(
  GATEWAY_CONFIG_PROVIDER_IDS,
);

const CONFIGURATION_PROVIDER_IDS: ReadonlySet<string> = new Set([
  ...CLOUD_CONFIGURATION_PROVIDER_IDS,
  ...LOCAL_CONFIGURATION_PROVIDER_IDS,
  ...GATEWAY_CONFIGURATION_PROVIDER_IDS,
]);

/**
 * Real, actionable per-status text for the Claude Agent SDK connection
 * probe (getClaudeSubscriptionStatus) — never a generic "Something went
 * wrong". Each status maps to what the user should actually do next.
 */
function describeClaudeSubscriptionStatus(
  result: ClaudeSubscriptionStatusResult,
): string {
  switch (result.status) {
    case 'NOT_INSTALLED':
      return (
        'The Claude Agent SDK is not installed. This should be bundled ' +
        'with PLUMB — try reinstalling, or report this as a bug.' +
        (result.detail ? ` (${result.detail})` : '')
      );
    case 'NOT_LOGGED_IN':
      return (
        'Not signed in to a Claude subscription. Run "claude login" in ' +
        'your terminal (from the Claude Code CLI / Agent SDK), then press ' +
        'Enter here to retry.'
      );
    case 'SESSION_EXPIRED':
      return (
        'Your Claude session has expired. Run "claude login" again, then ' +
        'press Enter here to retry.'
      );
    case 'PLAN_UNSUPPORTED':
      return (
        "Your Claude plan doesn't support the Agent SDK integration. Use " +
        '"Anthropic API" (direct API key) instead.'
      );
    case 'UPSTREAM_POLICY_CHANGED':
      return (
        "Anthropic's policy for third-party Agent SDK usage has changed " +
        'since this integration was built. This provider is temporarily ' +
        'unavailable until PLUMB is updated.'
      );
    case 'AGENT_SDK_UNAVAILABLE':
    default:
      return (
        'Could not reach the Claude Agent SDK. Check your network ' +
        'connection and press Enter here to retry.' +
        (result.detail ? ` (${result.detail})` : '')
      );
  }
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
  onLogout?: (providerId: string) => Promise<void>;
  onRefreshModels?: (
    providerId?: string,
    apiKey?: string,
  ) => Promise<Array<{ id: string; name?: string; provider: string }>>;
  onRefreshFullModels?: () => Promise<PlumbModel[]>;
  /**
   * Re-runs discovery of the provider/model inventory. Passed through to
   * the custom-provider manager screen so a create/edit/delete there is
   * reflected in this dialog's provider list the moment the user backs out
   * of the manager -- without it the Custom Endpoint category would keep
   * showing stale entries until setup was closed and reopened.
   */
  onRefreshProviders?: () => void;
  completionStage?: string;
}

/**
 * Discriminated by `kind`, not a flat bag every provider overloads.
 *
 * `api-credential`: the pre-existing flow (OAuth/API-key/device-code/local/
 * external-authority providers) -- AppContainer commits `apiKey` (if any)
 * through the canonical credential store exactly as before. Unchanged
 * shape/behavior; every existing provider construction site keeps working.
 *
 * `cloud-configuration`: rich multi-field cloud providers (OCI/Bedrock/
 * Azure/Vertex/watsonx). The setup screen itself has ALREADY persisted the
 * validated safe config + credential through the canonical domain
 * save operation (validateXConfig -> buildXSaveOperation -> credential
 * store + saveProviderCloudConfig) by the time this fires -- this result
 * only communicates that success and which model to select next. No
 * secret/cloud field is transported through this object, through
 * AppContainer, or through any further React layer.
 */
export type PlumbProviderSetupResult =
  | {
      kind: 'api-credential';
      providerId: string;
      modelId: string;
      apiKey?: string;
      smolModel?: string;
      planningModel?: string;
    }
  | {
      kind: 'cloud-configuration';
      providerId: string;
      modelId: string;
      smolModel?: string;
      planningModel?: string;
    };

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
  onLogout,
  onRefreshModels,
  onRefreshFullModels,
  onRefreshProviders,
  completionStage,
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
    connectionAuthState: null,
  });
  const [confirmPending, setConfirmPending] = useState(false);
  // Stable across renders -- PlumbCustomProviderManagerScreen re-loads its
  // list whenever this identity changes, so constructing it fresh on every
  // render (e.g. inline in JSX) would re-trigger that load loop forever.
  const customProviderActions = useMemo(
    () => createCustomProviderConfigActions(),
    [],
  );
  const localConfigSchema = useMemo(
    () =>
      state.selectedProvider
        ? getLocalProviderConfigSchema(state.selectedProvider.id)
        : undefined,
    [state.selectedProvider],
  );
  const localConfigActions = useMemo(
    () =>
      state.selectedProvider
        ? getLocalProviderConfigActions(state.selectedProvider.id)
        : undefined,
    [state.selectedProvider],
  );
  const gatewayConfigSchema = useMemo(
    () =>
      state.selectedProvider
        ? getGatewayProviderConfigSchema(state.selectedProvider.id)
        : undefined,
    [state.selectedProvider],
  );
  const gatewayConfigActions = useMemo(
    () =>
      state.selectedProvider
        ? getGatewayProviderConfigActions(state.selectedProvider.id)
        : undefined,
    [state.selectedProvider],
  );

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

  const providerItems = useMemo(() => {
    const items = categoryProviders.map((p) => ({
      key: p.id,
      value: p,
      label: p.name,
      sublabel: p.description,
    }));
    if (state.category === PlumbProviderCategory.CUSTOM_ENDPOINT) {
      items.push({
        key: MANAGE_CUSTOM_PROVIDERS_ID,
        value: {
          id: MANAGE_CUSTOM_PROVIDERS_ID,
          name: 'Manage custom providers…',
          category: PlumbProviderCategory.CUSTOM_ENDPOINT,
          authMethods: [{ type: 'none' }],
          available: true,
        } as PlumbProvider,
        label: 'Manage custom providers…',
        sublabel:
          'Add, edit, or remove custom OpenAI/Anthropic/Gemini endpoints',
      });
    }
    return items;
  }, [categoryProviders, state.category]);

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

  // Claude Subscription (Agent SDK) has no PLUMB-initiated OAuth/API-key
  // flow — the Agent SDK owns login (`claude login`, external to PLUMB).
  // Instead of the generic authenticate step, this probes the real
  // connection status and routes straight to model-select when connected,
  // or shows the actual reason (with a real remediation step) when not.
  // Also used as the Enter-to-retry handler from the authenticate step.
  const probeClaudeSubscription = useCallback((provider: PlumbProvider) => {
    setState((s) => ({
      ...s,
      step: 'authenticate',
      selectedProvider: provider,
      connectionAuthState: null,
      error: null,
      loading: true,
      oauthStatus: null,
    }));
    void (async () => {
      try {
        const result = await getClaudeSubscriptionStatus();
        if (result.status === 'CONNECTED_SUBSCRIPTION') {
          setState((s) => ({
            ...s,
            step: 'model-select',
            connectionAuthState: 'authenticated',
            loading: false,
            error: null,
          }));
        } else {
          setState((s) => ({
            ...s,
            step: 'authenticate',
            loading: false,
            error: describeClaudeSubscriptionStatus(result),
          }));
        }
      } catch (err) {
        setState((s) => ({
          ...s,
          step: 'authenticate',
          loading: false,
          error:
            err instanceof Error
              ? err.message
              : 'Failed to check Claude subscription status.',
        }));
      }
    })();
  }, []);

  const handleProviderSelect = useCallback(
    (provider: PlumbProvider) => {
      setApiKeyInput('');

      if (provider.id === MANAGE_CUSTOM_PROVIDERS_ID) {
        setState((s) => ({
          ...s,
          step: 'manage-custom-providers',
          error: null,
        }));
        return;
      }

      if (provider.id === CLAUDE_SUBSCRIPTION_PROVIDER_ID) {
        probeClaudeSubscription(provider);
        return;
      }

      // Cloud-configuration providers (OCI/Bedrock/Azure/Vertex/watsonx) own
      // their own configured-vs-unconfigured detection internally (safe
      // config + credential presence, not the OAuth-oriented registry
      // authState below) -- route straight to the rich form, which renders
      // its own "Configured" summary/actions when applicable.
      if (CONFIGURATION_PROVIDER_IDS.has(provider.id)) {
        setState((s) => ({
          ...s,
          step: 'cloud-config',
          selectedProvider: provider,
          connectionAuthState: null,
          error: null,
          loading: false,
          oauthStatus: null,
        }));
        return;
      }

      // Read the real connection state from the canonical registry before
      // deciding where to route — never restart device-code/OAuth login for a
      // provider that already has a usable credential (that state is derived
      // fresh here, not cached, so it reflects logins/logouts that happened
      // earlier in this same running process).
      if (!provider.allowUnauthenticated) {
        const providerState = getPlumbProviderRegistry().getProviderState(
          provider.id,
        );
        if (
          providerState?.authState === 'authenticated' ||
          providerState?.authState === 'expired'
        ) {
          setState((s) => ({
            ...s,
            step: 'connected',
            selectedProvider: provider,
            connectionAuthState: providerState.authState,
            error: null,
            loading: false,
            oauthStatus: null,
          }));
          return;
        }
      }

      setState((s) => ({
        ...s,
        step: provider.allowUnauthenticated ? 'model-select' : 'authenticate',
        selectedProvider: provider,
        connectionAuthState: null,
        error: null,
        loading: false,
        oauthStatus: null,
      }));
    },
    [probeClaudeSubscription],
  );

  const handleConnectedAction = useCallback(
    (action: 'continue' | 'reauth' | 'logout') => {
      if (action === 'continue') {
        setState((s) => ({ ...s, step: 'model-select' }));
        return;
      }
      if (action === 'reauth') {
        setState((s) => ({ ...s, step: 'authenticate' }));
        return;
      }
      // action === 'logout'
      const providerId = state.selectedProvider?.id;
      if (!providerId) return;
      setState((s) => ({ ...s, loading: true }));
      void (async () => {
        try {
          if (onLogout) await onLogout(providerId);
        } finally {
          setState((s) => ({
            ...s,
            step: 'provider-select',
            selectedProvider: null,
            connectionAuthState: null,
            loading: false,
          }));
        }
      })();
    },
    [state.selectedProvider, onLogout],
  );

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
            const refreshed = await onRefreshModels(state.selectedProvider.id);
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
      const trimmed = key.trim();
      const selectedProviderId = state.selectedProvider?.id;
      if (!selectedProviderId) return;
      // Validate the API key against the OMP coding-plan endpoint BEFORE
      // accepting it. Plan id is the OMP id (or PLUMB presentation id) for
      // selected provider. The OMP validation normalizes errors to safe
      // PLUMB messages — no upstream body / URL / request ID is exposed.
      if (state.selectedProvider) {
        const plan = getCodingPlan(selectedProviderId);
        if (plan) {
          setState((s) => ({ ...s, loading: true, error: null }));
          const result = await validateCodingPlanApiKey(plan, trimmed);
          if (!result.valid) {
            setState((s) => ({
              ...s,
              loading: false,
              error: result.error ?? 'API key validation failed.',
            }));
            return;
          }
        }
      }
      setState((s) => ({
        ...s,
        step: 'model-select',
        apiKey: trimmed,
        error: null,
        loading: false,
      }));
      // Refresh models after API key submission (like OAuth does)
      if (onRefreshModels) {
        try {
          const refreshed = await onRefreshModels(selectedProviderId, trimmed);
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
    [onRefreshModels, onRefreshFullModels, state.selectedProvider],
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
      if (CONFIGURATION_PROVIDER_IDS.has(state.selectedProvider.id)) {
        onComplete({
          kind: 'cloud-configuration',
          providerId: state.selectedProvider.id,
          modelId: state.selectedModel,
          smolModel: state.smolModel ?? undefined,
          planningModel: state.planningModel ?? undefined,
        });
      } else {
        onComplete({
          kind: 'api-credential',
          providerId: state.selectedProvider.id,
          modelId: state.selectedModel,
          apiKey: state.apiKey || undefined,
          smolModel: state.smolModel ?? undefined,
          planningModel: state.planningModel ?? undefined,
        });
      }
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
      // PlumbCloudProviderConfigForm owns its own useKeypress subscription
      // for this step (navigation/select/edit/save/back all handled
      // internally against the OCI domain schema) -- this outer handler
      // must not also process/consume events here, or Escape/Enter would
      // double-fire (once here with generic 'authenticate'-shaped
      // semantics, once inside the form with the real cloud-config
      // semantics).
      // PlumbCustomProviderManagerScreen likewise owns its own Escape
      // semantics (list -> onClose, form -> back to list) -- same reasoning
      // as the cloud-config guard above.
      if (step === 'cloud-config' || step === 'manage-custom-providers') {
        return;
      }
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
        if (step === 'connected') {
          setState((s) => ({
            ...s,
            step: 'provider-select',
            selectedProvider: null,
            connectionAuthState: null,
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
          // A provider entered via the 'connected' step (already had a
          // usable credential) backs out to 'connected', not 'authenticate'
          // — Escape must never re-offer a login the user didn't ask for.
          if (state.connectionAuthState) {
            setState((s) => ({ ...s, step: 'connected', selectedModel: null }));
            return true;
          }
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
        // Claude Subscription has no PLUMB-initiated login — Enter re-runs
        // the connection probe (e.g. after the user has run `claude login`
        // in another terminal per the remediation text shown above).
        if (
          provider?.id === CLAUDE_SUBSCRIPTION_PROVIDER_ID &&
          keyMatchers[Command.RETURN](key)
        ) {
          probeClaudeSubscription(provider);
          return true;
        }
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
        // Env-only providers (e.g. Amazon Bedrock, Azure OpenAI): the real
        // credential is entirely ambient environment variables the user
        // sets outside PLUMB — there is nothing to type or an OAuth flow to
        // start. Without this branch, Enter here matched none of the
        // branches above and was silently swallowed (return true at the
        // bottom of this block) — a real dead-end identical to the one
        // fixed for Claude Subscription, just triggered by a different
        // authMethods shape (env-only, no oauth/api_key/device_code).
        if (
          keyMatchers[Command.RETURN](key) &&
          apiKeyInput.length === 0 &&
          provider?.authMethods.every((m) => m.type === 'env') &&
          provider.authMethods.length > 0
        ) {
          setState((s) => ({ ...s, step: 'model-select' }));
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
        if (step === 'connected') {
          setState((s) => ({
            ...s,
            step: 'provider-select',
            selectedProvider: null,
            connectionAuthState: null,
          }));
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

      {step === 'manage-custom-providers' && (
        <PlumbCustomProviderManagerScreen
          actions={customProviderActions}
          onClose={() => {
            onRefreshProviders?.();
            setState((s) => ({ ...s, step: 'provider-select', error: null }));
          }}
        />
      )}

      {step === 'connected' && provider && (
        <Box flexDirection="column">
          <Text bold>{provider.name}</Text>
          <Box marginY={1}>
            <Text
              color={
                state.connectionAuthState === 'expired' ? 'yellow' : 'green'
              }
            >
              Status:{' '}
              {state.connectionAuthState === 'expired'
                ? 'Session expired'
                : 'Connected'}
            </Text>
          </Box>
          {state.connectionAuthState === 'authenticated' && (
            <Box marginBottom={1}>
              <Text dimColor>
                {providerFullModels.length} model
                {providerFullModels.length === 1 ? '' : 's'} available
              </Text>
            </Box>
          )}
          <RadioButtonSelect
            items={[
              ...(state.connectionAuthState === 'authenticated'
                ? [
                    {
                      key: 'continue',
                      value: 'continue' as const,
                      label: 'Continue using this account',
                    },
                  ]
                : []),
              {
                key: 'reauth',
                value: 'reauth' as const,
                label: 'Re-authenticate',
              },
              { key: 'logout', value: 'logout' as const, label: 'Logout' },
            ]}
            onSelect={handleConnectedAction}
            isFocused={true}
            showNumbers={false}
          />
          <Box marginTop={1}>
            <Text dimColor>Backspace: back to provider list</Text>
          </Box>
        </Box>
      )}

      {step === 'cloud-config' && provider?.id === 'oci-genai' && (
        <PlumbCloudProviderConfigForm
          onContinue={() => {
            setState((s) => ({ ...s, step: 'model-select' }));
          }}
          onCancel={() => {
            setState((s) => ({
              ...s,
              step: 'provider-select',
              selectedProvider: null,
            }));
          }}
        />
      )}

      {step === 'cloud-config' && provider?.id === 'amazon-bedrock' && (
        <PlumbGenericCloudConfigForm
          title="Amazon Bedrock"
          schema={BEDROCK_CONFIG_SCHEMA}
          actions={bedrockCloudConfigActions}
          onContinue={() => {
            setState((s) => ({ ...s, step: 'model-select' }));
          }}
          onCancel={() => {
            setState((s) => ({
              ...s,
              step: 'provider-select',
              selectedProvider: null,
            }));
          }}
        />
      )}

      {step === 'cloud-config' && provider?.id === 'google-vertex' && (
        <PlumbGenericCloudConfigForm
          title="Google Vertex AI"
          schema={VERTEX_CONFIG_SCHEMA}
          actions={vertexCloudConfigActions}
          onContinue={() => {
            setState((s) => ({ ...s, step: 'model-select' }));
          }}
          onCancel={() => {
            setState((s) => ({
              ...s,
              step: 'provider-select',
              selectedProvider: null,
            }));
          }}
        />
      )}

      {step === 'cloud-config' && provider?.id === 'watsonx' && (
        <PlumbGenericCloudConfigForm
          title="IBM watsonx.ai"
          schema={WATSONX_CONFIG_SCHEMA}
          actions={watsonxCloudConfigActions}
          onContinue={() => {
            setState((s) => ({ ...s, step: 'model-select' }));
          }}
          onCancel={() => {
            setState((s) => ({
              ...s,
              step: 'provider-select',
              selectedProvider: null,
            }));
          }}
        />
      )}

      {step === 'cloud-config' && provider?.id === 'azure' && (
        <PlumbAzureCloudConfigForm
          onContinue={() => {
            setState((s) => ({ ...s, step: 'model-select' }));
          }}
          onCancel={() => {
            setState((s) => ({
              ...s,
              step: 'provider-select',
              selectedProvider: null,
            }));
          }}
        />
      )}

      {step === 'cloud-config' &&
        provider &&
        LOCAL_CONFIGURATION_PROVIDER_IDS.has(provider.id) &&
        localConfigSchema &&
        localConfigActions && (
          <PlumbGenericCloudConfigForm
            title={provider.name}
            schema={localConfigSchema}
            actions={localConfigActions}
            onContinue={() => {
              if (providerFullModels.length > 0) {
                setState((s) => ({ ...s, step: 'model-select' }));
                return;
              }
              setState((s) => ({ ...s, loading: true, error: null }));
              void (async () => {
                try {
                  await localConfigActions.refresh();
                  if (onRefreshModels) {
                    setDynamicModels(await onRefreshModels());
                  }
                  if (onRefreshFullModels) {
                    setDynamicFullModels(await onRefreshFullModels());
                  }
                  setState((s) => ({
                    ...s,
                    step: 'model-select',
                    loading: false,
                  }));
                } catch (err) {
                  setState((s) => ({
                    ...s,
                    loading: false,
                    error:
                      err instanceof Error
                        ? err.message
                        : 'SERVER_UNAVAILABLE: local server could not be reached.',
                  }));
                }
              })();
            }}
            onCancel={() => {
              setState((s) => ({
                ...s,
                step: 'provider-select',
                selectedProvider: null,
              }));
            }}
          />
        )}

      {step === 'cloud-config' &&
        provider &&
        GATEWAY_CONFIGURATION_PROVIDER_IDS.has(provider.id) &&
        gatewayConfigSchema &&
        gatewayConfigActions && (
          <PlumbGenericCloudConfigForm
            title={provider.name}
            schema={gatewayConfigSchema}
            actions={gatewayConfigActions}
            onContinue={() => {
              setState((s) => ({ ...s, loading: true, error: null }));
              void (async () => {
                try {
                  if (onRefreshModels) {
                    setDynamicModels(await onRefreshModels());
                  }
                  if (onRefreshFullModels) {
                    setDynamicFullModels(await onRefreshFullModels());
                  }
                  setState((s) => ({
                    ...s,
                    step: 'model-select',
                    loading: false,
                  }));
                } catch (err) {
                  setState((s) => ({
                    ...s,
                    loading: false,
                    error:
                      err instanceof Error
                        ? err.message
                        : 'Gateway model discovery failed.',
                  }));
                }
              })();
            }}
            onCancel={() => {
              setState((s) => ({
                ...s,
                step: 'provider-select',
                selectedProvider: null,
              }));
            }}
          />
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
                  step: CONFIGURATION_PROVIDER_IDS.has(provider.id)
                    ? 'cloud-config'
                    : provider.allowUnauthenticated
                      ? 'provider-select'
                      : 'authenticate',
                }))
              }
              onRefresh={
                onRefreshFullModels
                  ? async () => {
                      if (onRefreshModels) {
                        const refreshed = await onRefreshModels(
                          provider.id,
                          state.apiKey,
                        );
                        setDynamicModels(refreshed);
                      }
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
              <Text dimColor>
                {LOCAL_CONFIGURATION_PROVIDER_IDS.has(provider.id)
                  ? 'SERVER_UNAVAILABLE: no models were returned by the configured local server.'
                  : 'No models available for this provider.'}
              </Text>
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
          <Text color="yellow">confirm.stage: {completionStage ?? 'idle'}</Text>
          <Text color="yellow">
            onComplete.resolved:{' '}
            {completionStage === 'completed'
              ? 'true'
              : completionStage?.startsWith('failed')
                ? 'error'
                : 'pending'}
          </Text>
          {completionStage?.startsWith('failed:') && (
            <Text color="red">last.safe.error: {completionStage.slice(7)}</Text>
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

  // Where the user obtains their key for API-key coding plans (OpenCode Go,
  // Alibaba, Zhipu, ...). Sourced from the coding-plan definition, never a
  // guessed URL.
  const apiKeyAuthUrl =
    getCodingPlan(provider.id)?.authUrl ?? provider.description;

  // Claude Subscription has no PLUMB-initiated auth method at all
  // (authMethods: [{type: 'none'}]) — the generic hasOAuth/hasApiKey/
  // hasDeviceCode/hasEnv branches below would render an empty box with a
  // misleading "Type API key and press Enter" footer. The real status
  // (with a real remediation step) is already surfaced via the error
  // banner above this component; this just explains what Enter does here.
  if (provider.id === 'claude-subscription') {
    return (
      <Box flexDirection="column">
        <Text bold>Authenticate: {provider.name}</Text>
        <Box flexDirection="column" marginY={1}>
          <Text>
            This provider is connected through the official Claude Agent SDK,
            which manages its own sign-in outside of PLUMB.
          </Text>
        </Box>
        <Box>
          <Text dimColor>Press Enter to retry • Backspace to go back</Text>
        </Box>
      </Box>
    );
  }

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
              You will be given a short code and URL. Visit the URL, enter the
              code, and approve sign-in in your browser — no password is ever
              shared with {provider.name}.
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
            {apiKeyAuthUrl && !hasOAuth && (
              <Text dimColor>
                Get your key from:{' '}
                {getCodingPlan(provider.id)?.authUrl ?? provider.description}
              </Text>
            )}
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
            : hasEnv && !hasApiKey && !hasOAuth && !hasDeviceCode
              ? 'Press Enter once the environment variables above are set • Backspace to go back'
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
    case 'manage-custom-providers':
      return 2;
    case 'connected':
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

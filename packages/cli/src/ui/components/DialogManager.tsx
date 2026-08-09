/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { IdeIntegrationNudge } from '../IdeIntegrationNudge.js';
import { LoopDetectionConfirmation } from './LoopDetectionConfirmation.js';
import { FolderTrustDialog } from './FolderTrustDialog.js';
import { ConsentPrompt } from './ConsentPrompt.js';
import { ThemeDialog } from './ThemeDialog.js';
import { SettingsDialog } from './SettingsDialog.js';
import { AuthInProgress } from '../auth/AuthInProgress.js';
import { BannedAccountDialog } from '../auth/BannedAccountDialog.js';
import { ApiAuthDialog } from '../auth/ApiAuthDialog.js';
import { AuthState } from '../types.js';
import { EditorSettingsDialog } from './EditorSettingsDialog.js';
import { PrivacyNotice } from '../privacy/PrivacyNotice.js';
import { ProQuotaDialog } from './ProQuotaDialog.js';
import { ValidationDialog } from './ValidationDialog.js';
import { OverageMenuDialog } from './OverageMenuDialog.js';
import { EmptyWalletDialog } from './EmptyWalletDialog.js';
import { relaunchApp } from '../../utils/processUtils.js';
import { SessionBrowser } from './SessionBrowser.js';
import { PermissionsModifyTrustDialog } from './PermissionsModifyTrustDialog.js';
import { ModelDialog } from './ModelDialog.js';
import { PlumbModelDialog } from './PlumbModelDialog.js';
import { VoiceModelDialog } from './VoiceModelDialog.js';
import { AuthType } from '@google/gemini-cli-core';
import { theme } from '../semantic-colors.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useQuotaState } from '../contexts/QuotaContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import { useConfig } from '../contexts/ConfigContext.js';
import { useSettings } from '../contexts/SettingsContext.js';
import process from 'node:process';
import { type UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import { AdminSettingsChangedDialog } from './AdminSettingsChangedDialog.js';
import { IdeTrustChangeDialog } from './IdeTrustChangeDialog.js';
import { NewAgentsNotification } from './NewAgentsNotification.js';
import { AgentConfigDialog } from './AgentConfigDialog.js';
import { PolicyUpdateDialog } from './PolicyUpdateDialog.js';
import { LoginRestartDialog } from '../auth/LoginRestartDialog.js';
import { PlumbProviderSetupDialog } from './PlumbProviderSetupDialog.js';
import { useProviderSetupData } from '../hooks/useProviderSetupData.js';

interface DialogManagerProps {
  addItem: UseHistoryManagerReturn['addItem'];
  terminalWidth: number;
}

// Props for DialogManager
export const DialogManager = ({
  addItem,
  terminalWidth,
}: DialogManagerProps) => {
  const config = useConfig();
  const settings = useSettings();

  const uiState = useUIState();
  const quotaState = useQuotaState();
  const uiActions = useUIActions();
  const {
    constrainHeight,
    terminalHeight,
    staticExtraHeight,
    terminalWidth: uiTerminalWidth,
  } = uiState;
  const providerSetupData = useProviderSetupData(
    uiState.isProviderSetupDialogOpen,
  );

  if (uiState.adminSettingsChanged) {
    return <AdminSettingsChangedDialog />;
  }
  if (uiState.showIdeRestartPrompt) {
    return <IdeTrustChangeDialog reason={uiState.ideTrustRestartReason} />;
  }
  if (uiState.newAgents) {
    return (
      <NewAgentsNotification
        agents={uiState.newAgents}
        onSelect={uiActions.handleNewAgentsSelect}
      />
    );
  }
  if (quotaState.proQuotaRequest) {
    return (
      <ProQuotaDialog
        failedModel={quotaState.proQuotaRequest.failedModel}
        fallbackModel={quotaState.proQuotaRequest.fallbackModel}
        message={quotaState.proQuotaRequest.message}
        isTerminalQuotaError={quotaState.proQuotaRequest.isTerminalQuotaError}
        isModelNotFoundError={!!quotaState.proQuotaRequest.isModelNotFoundError}
        authType={quotaState.proQuotaRequest.authType}
        tierName={config?.getUserTierName()}
        onChoice={uiActions.handleProQuotaChoice}
      />
    );
  }
  if (quotaState.validationRequest) {
    return (
      <ValidationDialog
        validationLink={quotaState.validationRequest.validationLink}
        validationDescription={
          quotaState.validationRequest.validationDescription
        }
        learnMoreUrl={quotaState.validationRequest.learnMoreUrl}
        onChoice={uiActions.handleValidationChoice}
      />
    );
  }
  if (quotaState.overageMenuRequest) {
    return (
      <OverageMenuDialog
        failedModel={quotaState.overageMenuRequest.failedModel}
        fallbackModel={quotaState.overageMenuRequest.fallbackModel}
        resetTime={quotaState.overageMenuRequest.resetTime}
        creditBalance={quotaState.overageMenuRequest.creditBalance}
        onChoice={uiActions.handleOverageMenuChoice}
      />
    );
  }
  if (quotaState.emptyWalletRequest) {
    return (
      <EmptyWalletDialog
        failedModel={quotaState.emptyWalletRequest.failedModel}
        fallbackModel={quotaState.emptyWalletRequest.fallbackModel}
        resetTime={quotaState.emptyWalletRequest.resetTime}
        onGetCredits={quotaState.emptyWalletRequest.onGetCredits}
        onChoice={uiActions.handleEmptyWalletChoice}
      />
    );
  }
  if (uiState.shouldShowIdePrompt) {
    return (
      <IdeIntegrationNudge
        ide={uiState.currentIDE!}
        onComplete={uiActions.handleIdePromptComplete}
      />
    );
  }
  if (uiState.isFolderTrustDialogOpen) {
    return (
      <FolderTrustDialog
        onSelect={uiActions.handleFolderTrustSelect}
        isRestarting={uiState.isRestarting}
        discoveryResults={uiState.folderDiscoveryResults}
      />
    );
  }
  if (uiState.isPolicyUpdateDialogOpen) {
    return (
      <PolicyUpdateDialog
        config={config}
        request={uiState.policyUpdateConfirmationRequest!}
        onClose={() => uiActions.setIsPolicyUpdateDialogOpen(false)}
      />
    );
  }
  if (uiState.loopDetectionConfirmationRequest) {
    return (
      <LoopDetectionConfirmation
        onComplete={uiState.loopDetectionConfirmationRequest.onComplete}
      />
    );
  }

  if (uiState.permissionConfirmationRequest) {
    const files = uiState.permissionConfirmationRequest.files;
    const filesList = files.map((f) => `- ${f}`).join('\n');
    return (
      <ConsentPrompt
        prompt={`The following files are outside your workspace:\n\n${filesList}\n\nDo you want to allow this read?`}
        onConfirm={(allowed) => {
          uiState.permissionConfirmationRequest?.onComplete({ allowed });
        }}
        terminalWidth={terminalWidth}
      />
    );
  }

  // commandConfirmationRequest and authConsentRequest are kept separate
  // to avoid focus deadlocks and state race conditions between the
  // synchronous command loop and the asynchronous auth flow.
  if (uiState.commandConfirmationRequest) {
    return (
      <ConsentPrompt
        prompt={uiState.commandConfirmationRequest.prompt}
        onConfirm={uiState.commandConfirmationRequest.onConfirm}
        terminalWidth={terminalWidth}
      />
    );
  }
  if (uiState.authConsentRequest) {
    return (
      <ConsentPrompt
        prompt={uiState.authConsentRequest.prompt}
        onConfirm={uiState.authConsentRequest.onConfirm}
        terminalWidth={terminalWidth}
      />
    );
  }
  if (uiState.confirmUpdateExtensionRequests.length > 0) {
    const request = uiState.confirmUpdateExtensionRequests[0];
    return (
      <ConsentPrompt
        prompt={request.prompt}
        onConfirm={request.onConfirm}
        terminalWidth={terminalWidth}
      />
    );
  }
  if (uiState.isThemeDialogOpen) {
    return (
      <Box flexDirection="column">
        {uiState.themeError && (
          <Box marginBottom={1}>
            <Text color={theme.status.error}>{uiState.themeError}</Text>
          </Box>
        )}
        <ThemeDialog
          onSelect={uiActions.handleThemeSelect}
          onCancel={uiActions.closeThemeDialog}
          onHighlight={uiActions.handleThemeHighlight}
          settings={settings}
          availableTerminalHeight={
            constrainHeight ? terminalHeight - staticExtraHeight : undefined
          }
          terminalWidth={uiTerminalWidth}
        />
      </Box>
    );
  }
  if (uiState.isSettingsDialogOpen) {
    return (
      <Box flexDirection="column">
        <SettingsDialog
          onSelect={() => uiActions.closeSettingsDialog()}
          onRestartRequest={relaunchApp}
          availableTerminalHeight={terminalHeight - staticExtraHeight}
        />
      </Box>
    );
  }
  if (uiState.isModelDialogOpen) {
    // Provider-aware /model for PLUMB_PROVIDER sessions; the legacy
    // Gemini-only dialog stays for non-PLUMB auth (USE_GEMINI/USE_VERTEX_AI
    // etc.), which never touches the provider registry.
    if (
      settings.merged.security.auth.selectedType === AuthType.PLUMB_PROVIDER
    ) {
      return <PlumbModelDialog onClose={uiActions.closeModelDialog} />;
    }
    return <ModelDialog onClose={uiActions.closeModelDialog} />;
  }
  if (uiState.isVoiceModelDialogOpen) {
    return <VoiceModelDialog onClose={uiActions.closeVoiceModelDialog} />;
  }
  if (
    uiState.isAgentConfigDialogOpen &&
    uiState.selectedAgentName &&
    uiState.selectedAgentDisplayName &&
    uiState.selectedAgentDefinition
  ) {
    return (
      <Box flexDirection="column">
        <AgentConfigDialog
          agentName={uiState.selectedAgentName}
          displayName={uiState.selectedAgentDisplayName}
          definition={uiState.selectedAgentDefinition}
          settings={settings}
          availableTerminalHeight={terminalHeight - staticExtraHeight}
          onClose={uiActions.closeAgentConfigDialog}
          onSave={async () => {
            // Reload agent registry to pick up changes
            const agentRegistry = config?.getAgentRegistry();
            if (agentRegistry) {
              await agentRegistry.reload();
            }
          }}
        />
      </Box>
    );
  }
  if (uiState.accountSuspensionInfo) {
    return (
      <Box flexDirection="column">
        <BannedAccountDialog
          accountSuspensionInfo={uiState.accountSuspensionInfo}
          onExit={() => {
            process.exit(1);
          }}
          onChangeAuth={() => {
            uiActions.clearAccountSuspension();
          }}
        />
      </Box>
    );
  }
  // PLUMB provider-first route: the multi-provider setup dialog owns the
  // screen whenever it is open — including the empty-state startup where it
  // replaces the legacy Google-first auth dialog.
  if (uiState.isProviderSetupDialogOpen) {
    const refreshModels = async (providerId?: string, apiKey?: string) => {
      const providerPackage = await import('@google/gemini-cli-provider');
      const modelRegistry = providerPackage.getPlumbModelRegistry();
      if (providerId) {
        const state = providerPackage
          .getPlumbProviderRegistry()
          .getProviderState(providerId);
        const storedApiKey =
          state?.credentials?.type === 'api_key'
            ? state.credentials.key
            : undefined;
        const oauthToken =
          state?.credentials?.type === 'oauth'
            ? state.credentials.access
            : undefined;
        await modelRegistry.discoverProviderModels(
          providerId,
          apiKey ?? storedApiKey,
          oauthToken,
        );
      }
      return modelRegistry.getAllAvailableModels().map((model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
      }));
    };

    const refreshFullModels = async () => {
      const providerPackage = await import('@google/gemini-cli-provider');
      return providerPackage.getPlumbModelRegistry().getAllAvailableModels();
    };

    return (
      <Box flexDirection="column">
        <PlumbProviderSetupDialog
          providers={providerSetupData.providers}
          categoryGroups={providerSetupData.categoryGroups}
          models={providerSetupData.models}
          fullModels={providerSetupData.fullModels}
          onComplete={uiActions.handleProviderSetupComplete}
          onCancel={uiActions.closeProviderSetupDialog}
          onOAuthLogin={uiActions.handleProviderOAuthLogin}
          onLogout={uiActions.handleProviderLogout}
          onRefreshModels={refreshModels}
          onRefreshFullModels={refreshFullModels}
          completionStage={uiState.setupCompletionStage}
        />
      </Box>
    );
  }
  // AuthInProgress (OAuth wait) is only for real Google OAuth. API-key and
  // PLUMB_PROVIDER never set isAuthenticating. Cancel returns to PLUMB setup.
  if (uiState.isAuthenticating) {
    return (
      <AuthInProgress
        onTimeout={() => {
          // Never open legacy AuthDialog. Cancel → PLUMB provider setup.
          uiActions.onAuthError(null);
          uiActions.setAuthState(AuthState.Unauthenticated);
          uiActions.openProviderSetupDialog();
        }}
      />
    );
  }
  if (uiState.isAwaitingApiKeyInput) {
    return (
      <Box flexDirection="column">
        <ApiAuthDialog
          key={uiState.apiKeyDefaultValue}
          onSubmit={uiActions.handleApiKeySubmit}
          onCancel={uiActions.handleApiKeyCancel}
          error={uiState.authError}
          defaultValue={uiState.apiKeyDefaultValue}
        />
      </Box>
    );
  }

  if (uiState.isAwaitingLoginRestart) {
    return (
      <Box flexDirection="column">
        <LoginRestartDialog
          onDismiss={uiActions.dismissLoginRestart}
          config={config}
          message={uiState.loginRestartMessage}
        />
      </Box>
    );
  }
  // LEGACY AuthDialog (Get started / Google / Gemini / Vertex) is intentionally
  // NOT mounted in production. All auth routes go through PlumbProviderSetupDialog.
  // isAuthDialogOpen is forced false in AppContainer.
  if (uiState.isEditorDialogOpen) {
    return (
      <Box flexDirection="column">
        {uiState.editorError && (
          <Box marginBottom={1}>
            <Text color={theme.status.error}>{uiState.editorError}</Text>
          </Box>
        )}
        <EditorSettingsDialog
          onSelect={uiActions.handleEditorSelect}
          settings={settings}
          onExit={uiActions.exitEditorDialog}
        />
      </Box>
    );
  }
  if (uiState.showPrivacyNotice) {
    return (
      <PrivacyNotice
        onExit={() => uiActions.exitPrivacyNotice()}
        config={config}
      />
    );
  }
  if (uiState.isSessionBrowserOpen) {
    return (
      <SessionBrowser
        config={config}
        onResumeSession={uiActions.handleResumeSession}
        onDeleteSession={uiActions.handleDeleteSession}
        onExit={uiActions.closeSessionBrowser}
      />
    );
  }

  if (uiState.isPermissionsDialogOpen) {
    return (
      <PermissionsModifyTrustDialog
        onExit={uiActions.closePermissionsDialog}
        addItem={addItem}
        targetDirectory={uiState.permissionsDialogProps?.targetDirectory}
      />
    );
  }

  return null;
};

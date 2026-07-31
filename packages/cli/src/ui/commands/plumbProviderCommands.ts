/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
 

import type { SlashCommand, CommandContext } from './types.js';
import { AuthType } from '@google/gemini-cli-core';

// ─── /provider ──────────────────────────────────────────────────────────

export const providerCommand: SlashCommand = {
  name: 'provider',
  description: 'Manage provider selection',
  kind: 'BUILT_IN' as const,
  async action(context: CommandContext, args: string) {
    const trimmed = args?.trim() ?? '';

    if (trimmed === 'list' || trimmed === 'ls' || !trimmed) {
      // Show provider list — delegates to UI dialog
      return { type: 'dialog', dialog: 'provider-setup' as const };
    }

    if (trimmed.startsWith('set ') || trimmed.startsWith('select ')) {
      const providerId = trimmed.split(/\s+/)[1];
      if (!providerId) {
        context.ui.addItem({
          id: `provider-err-${Date.now()}`,
          type: 'info',
          content: 'Usage: /provider set <provider-id>',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      try {
        const settings = context.services.settings;
        if (settings) {
          // Update settings to use PLUMB_PROVIDER mode
          const { loadSettings, SettingScope } = await import(
            '../config/settings.js'
          );
          const loadedSettings = loadSettings();
          loadedSettings.setValue(
            SettingScope.User,
            'security.auth.selectedType',
            AuthType.PLUMB_PROVIDER,
          );
          loadedSettings.setValue(
            SettingScope.User,
            'plumb.provider.id',
            providerId,
          );
        }

        context.ui.addItem({
          id: `provider-set-${Date.now()}`,
          type: 'info',
          content: `Provider set to "${providerId}". Restart may be required.`,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        context.ui.addItem({
          id: `provider-err-${Date.now()}`,
          type: 'info',
          content: `Error setting provider: ${(err as Error).message}`,
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    context.ui.addItem({
      id: `provider-help-${Date.now()}`,
      type: 'info',
      content:
        'Usage:\n' +
        '  /provider           — list available providers\n' +
        '  /provider set <id>  — select a provider\n' +
        '  /plans              — show coding plans\n' +
        '  /login <provider>   — authenticate with a provider\n' +
        '  /logout             — sign out from current provider',
      timestamp: new Date().toISOString(),
    });
  },
  subCommands: [
    {
      name: 'list',
      description: 'List available providers',
      kind: 'BUILT_IN' as const,
      autoExecute: true,
      action: () => ({ type: 'dialog', dialog: 'provider-setup' as const }),
    },
    {
      name: 'set',
      description: 'Set active provider',
      kind: 'BUILT_IN' as const,
      takesArgs: true,
      action: async (ctx, args) => {
        if (!args?.trim()) {
          ctx.ui.addItem({
            id: `provider-err-${Date.now()}`,
            type: 'info',
            content: 'Usage: /provider set <provider-id>',
            timestamp: new Date().toISOString(),
          });
          return;
        }
        // Delegates to parent handler
        return providerCommand.action!(ctx, `set ${args}`);
      },
    },
  ],
};

// ─── /plans ─────────────────────────────────────────────────────────────

export const plansCommand: SlashCommand = {
  name: 'plans',
  description: 'List coding-plan and subscription providers',
  kind: 'BUILT_IN' as const,
  autoExecute: true,
  async action() {
    return { type: 'dialog', dialog: 'provider-setup' as const };
  },
};

// ─── /login ─────────────────────────────────────────────────────────────

export const loginCommand: SlashCommand = {
  name: 'login',
  description: 'Authenticate with a provider',
  kind: 'BUILT_IN' as const,
  async action(context: CommandContext, args: string) {
    const providerId = args?.trim();
    if (!providerId) {
      // Open provider selection for login
      return { type: 'dialog', dialog: 'provider-setup' as const };
    }

    context.ui.addItem({
      id: `login-start-${Date.now()}`,
      type: 'info',
      content: `Starting authentication for "${providerId}"...`,
      timestamp: new Date().toISOString(),
    });

    // Trigger provider-specific auth flow through the UI
    return { type: 'dialog', dialog: 'provider-setup' as const };
  },
  subCommands: [
    {
      name: 'list',
      description: 'List providers available for login',
      kind: 'BUILT_IN' as const,
      autoExecute: true,
      action: () => ({ type: 'dialog', dialog: 'provider-setup' as const }),
    },
  ],
};

// ─── /logout ────────────────────────────────────────────────────────────

export const logoutCommand: SlashCommand = {
  name: 'logout',
  description: 'Sign out from current provider',
  kind: 'BUILT_IN' as const,
  autoExecute: true,
  action: () => ({ type: 'logout' as const }),
};

// ─── /models ────────────────────────────────────────────────────────────

export const modelsCommand: SlashCommand = {
  name: 'models',
  description: 'List and select available models',
  kind: 'BUILT_IN' as const,
  async action(context: CommandContext, args: string) {
    const trimmed = args?.trim() ?? '';

    if (trimmed.startsWith('set ') || trimmed.startsWith('select ')) {
      const modelId = trimmed.split(/\s+/).slice(1).join(' ');
      if (!modelId) {
        context.ui.addItem({
          id: `model-err-${Date.now()}`,
          type: 'info',
          content: 'Usage: /models set <model-id>',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      context.services.agentContext?.config.setModel(modelId, true);
      context.ui.addItem({
        id: `model-set-${Date.now()}`,
        type: 'info',
        content: `Model set to "${modelId}".`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Default: open model selector
    return { type: 'dialog', dialog: 'model' as const };
  },
  subCommands: [
    {
      name: 'set',
      description: 'Set active model',
      kind: 'BUILT_IN' as const,
      takesArgs: true,
      action: async (ctx, args) => {
        if (!args?.trim()) {
          ctx.ui.addItem({
            id: `model-err-${Date.now()}`,
            type: 'info',
            content: 'Usage: /models set <model-id>',
            timestamp: new Date().toISOString(),
          });
          return;
        }
        ctx.services.agentContext?.config.setModel(args.trim(), true);
        ctx.ui.addItem({
          id: `model-set-${Date.now()}`,
          type: 'info',
          content: `Model set to "${args.trim()}".`,
          timestamp: new Date().toISOString(),
        });
      },
    },
  ],
};

// ─── /accounts ──────────────────────────────────────────────────────────

export const accountsCommand: SlashCommand = {
  name: 'accounts',
  description: 'List authenticated provider accounts',
  kind: 'BUILT_IN' as const,
  autoExecute: true,
  async action(context: CommandContext) {
    try {
      const { getPlumbCredentialStore } = await import(
        '@google/gemini-cli-provider'
      );
      const store = getPlumbCredentialStore();
      const authenticated = await store.listAuthenticatedProviders();

      if (authenticated.length === 0) {
        context.ui.addItem({
          id: `accounts-empty-${Date.now()}`,
          type: 'info',
          content:
            'No authenticated providers. Use /login to connect a provider.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const lines = ['Authenticated providers:'];
      for (const providerId of authenticated) {
        const creds = await store.getCredentials(providerId);
        for (const entry of creds) {
          const label =
            entry.credential.type === 'oauth'
              ? `[OAuth] ${entry.credential.email ?? 'no email'} (expires ${new Date(entry.credential.expires).toLocaleString()})`
              : `[API Key] ${entry.credential.label ?? 'unnamed'}`;
          lines.push(`  ${providerId}: ${label}`);
        }
      }

      context.ui.addItem({
        id: `accounts-${Date.now()}`,
        type: 'info',
        content: lines.join('\n'),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      context.ui.addItem({
        id: `accounts-err-${Date.now()}`,
        type: 'info',
        content: `Error listing accounts: ${(err as Error).message}`,
        timestamp: new Date().toISOString(),
      });
    }
  },
};

// ─── /credentials ───────────────────────────────────────────────────────

export const credentialsCommand: SlashCommand = {
  name: 'credentials',
  description: 'Manage stored provider credentials',
  kind: 'BUILT_IN' as const,
  async action(context: CommandContext, args: string) {
    const trimmed = args?.trim() ?? '';

    if (trimmed === 'clear' || trimmed === 'reset') {
      try {
        const { getPlumbCredentialStore } = await import(
          '@google/gemini-cli-provider'
        );
        await getPlumbCredentialStore().clearAll();
        context.ui.addItem({
          id: `creds-cleared-${Date.now()}`,
          type: 'info',
          content: 'All stored credentials cleared.',
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        context.ui.addItem({
          id: `creds-err-${Date.now()}`,
          type: 'info',
          content: `Error clearing credentials: ${(err as Error).message}`,
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    // Default: show accounts
    return accountsCommand.action!(context, '');
  },
  subCommands: [
    {
      name: 'clear',
      description: 'Clear all stored credentials',
      kind: 'BUILT_IN' as const,
      autoExecute: true,
      action: (ctx) => credentialsCommand.action!(ctx, 'clear'),
    },
  ],
};

// ─── /local-models ──────────────────────────────────────────────────────

export const localModelsCommand: SlashCommand = {
  name: 'local-models',
  description: 'Discover and list local models (Ollama, LM Studio)',
  kind: 'BUILT_IN' as const,
  autoExecute: true,
  async action(context: CommandContext) {
    try {
      const { getPlumbModelRegistry } = await import(
        '@google/gemini-cli-provider'
      );
      const registry = getPlumbModelRegistry();
      const discovered = await registry.discoverLocalModels();

      if (discovered.length === 0) {
        context.ui.addItem({
          id: `local-models-empty-${Date.now()}`,
          type: 'info',
          content:
            'No local models found.\n' +
            'Ensure Ollama is running (ollama serve) or LM Studio is active.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const lines = [`Local models discovered (${discovered.length}):`];
      for (const model of discovered) {
        lines.push(
          `  ${model.provider}/${model.id} — context: ${formatTokens(model.contextWindow)}, max: ${formatTokens(model.maxTokens)}`,
        );
      }

      context.ui.addItem({
        id: `local-models-${Date.now()}`,
        type: 'info',
        content: lines.join('\n'),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      context.ui.addItem({
        id: `local-models-err-${Date.now()}`,
        type: 'info',
        content: `Error discovering local models: ${(err as Error).message}`,
        timestamp: new Date().toISOString(),
      });
    }
  },
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

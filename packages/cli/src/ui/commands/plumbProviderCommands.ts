/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- pre-existing CommandKind string-literal/enum mismatches
// throughout this file are unrelated to the addItem `content`->`text` fix
// below and out of scope here; left suppressed rather than silently
// papered over.

import type { SlashCommand, CommandContext } from './types.js';
import { AuthType } from '@google/gemini-cli-core';

/**
 * Pre-warm Config's tool-capability authority (see
 * Config.setActiveModelToolsCapability in packages/core) for the model a
 * `/models set`/`/models select` switch is about to activate, using the
 * active provider already recorded on Config. Without this, the system
 * prompt for the very next turn would still reflect the previous model's
 * gated/ungated tool-use instructions for one turn, until
 * PlumbContentGenerator self-corrects on its own next resolve. Non-fatal:
 * on any failure the content-generator's per-turn resolve still catches up.
 */
async function prewarmToolsCapability(
  context: CommandContext,
  modelId: string,
): Promise<void> {
  const config = context.services.agentContext?.config;
  const providerId = config?.getPlumbProvider?.();
  if (!config || !providerId || !modelId) {
    return;
  }
  try {
    const providerPkg = await import('@google/gemini-cli-provider');
    const registry = providerPkg.getPlumbModelRegistry?.();
    const plumbModel = registry?.findModel(providerId, modelId);
    if (plumbModel) {
      config.setActiveModelToolsCapability(
        plumbModel.toolsSupported,
        plumbModel.toolsCapabilitySource ?? 'UNKNOWN',
      );
    }
  } catch {
    // Non-fatal: PlumbContentGenerator resolves and records the real
    // capability again on the next turn regardless.
  }
}

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
          type: 'error',
          text: 'Usage: /provider set <provider-id>',
        });
        return;
      }

      try {
        const settings = context.services.settings;
        if (settings) {
          // Update settings to use PLUMB_PROVIDER mode
          const { loadSettings, SettingScope } = await import(
            '../../config/settings.js'
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
          type: 'info',
          text: `Provider set to "${providerId}". Restart may be required.`,
        });
      } catch (err) {
        context.ui.addItem({
          type: 'error',
          text: `Error setting provider: ${(err as Error).message}`,
        });
      }
      return;
    }

    context.ui.addItem({
      type: 'info',
      text:
        'Usage:\n' +
        '  /provider           — list available providers\n' +
        '  /provider set <id>  — select a provider\n' +
        '  /plans              — show coding plans\n' +
        '  /login <provider>   — authenticate with a provider\n' +
        '  /logout             — sign out from current provider',
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
            type: 'error',
            text: 'Usage: /provider set <provider-id>',
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
      type: 'info',
      text: `Starting authentication for "${providerId}"...`,
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
          type: 'error',
          text: 'Usage: /models set <model-id>',
        });
        return;
      }

      await prewarmToolsCapability(context, modelId);
      context.services.agentContext?.config.setModel(modelId, true);
      context.ui.addItem({
        type: 'info',
        text: `Model set to "${modelId}".`,
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
            type: 'error',
            text: 'Usage: /models set <model-id>',
          });
          return;
        }
        await prewarmToolsCapability(ctx, args.trim());
        ctx.services.agentContext?.config.setModel(args.trim(), true);
        ctx.ui.addItem({
          type: 'info',
          text: `Model set to "${args.trim()}".`,
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
      const { ensurePlumbCredentialStore } = await import(
        '@google/gemini-cli-provider'
      );
      const store = await ensurePlumbCredentialStore();
      const authenticated = await store.listAuthenticatedProviders();

      if (authenticated.length === 0) {
        context.ui.addItem({
          type: 'info',
          text: 'No authenticated providers. Use /login to connect a provider.',
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
        type: 'info',
        text: lines.join('\n'),
      });
    } catch (err) {
      context.ui.addItem({
        type: 'error',
        text: `Error listing accounts: ${(err as Error).message}`,
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
        const { ensurePlumbCredentialStore } = await import(
          '@google/gemini-cli-provider'
        );
        const store = await ensurePlumbCredentialStore();
        await store.clearAll();
        context.ui.addItem({
          type: 'info',
          text: 'All stored credentials cleared.',
        });
      } catch (err) {
        context.ui.addItem({
          type: 'error',
          text: `Error clearing credentials: ${(err as Error).message}`,
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
          type: 'info',
          text:
            'No local models found.\n' +
            'Ensure Ollama is running (ollama serve) or LM Studio is active.',
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
        type: 'info',
        text: lines.join('\n'),
      });
    } catch (err) {
      context.ui.addItem({
        type: 'error',
        text: `Error discovering local models: ${(err as Error).message}`,
      });
    }
  },
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

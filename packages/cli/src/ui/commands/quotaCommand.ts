/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { MessageType } from '../types.js';
import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from './types.js';

const BAR_WIDTH = 20;

function bar(usedPercent: number): string {
  const clamped = Math.min(Math.max(usedPercent, 0), 100);
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

function fmtReset(resetsAt: number | undefined): string {
  if (resetsAt === undefined) return '';
  const diffMs = resetsAt - Date.now();
  if (diffMs <= 0) return '';
  const totalMinutes = Math.ceil(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `resets in ${hours}h ${minutes}m`;
  if (hours > 0) return `resets in ${hours}h`;
  return `resets in ${minutes}m`;
}

function fmtLine(
  label: string,
  usedPercent: number,
  resetsAt: number | undefined,
): string {
  const pct = `${Math.round(usedPercent)}%`.padStart(4);
  const reset = fmtReset(resetsAt);
  return `${label.padEnd(16)} [${bar(usedPercent)}] ${pct}${reset ? `  ${reset}` : ''}`;
}

async function renderClaudeSubscriptionUsage(): Promise<string[]> {
  const providerPkg = await import('@plumb/provider');
  const result = await providerPkg.fetchClaudeSubscriptionUsage();
  if (!result.ok) {
    switch (result.reason) {
      case 'NO_CREDENTIALS_FILE':
        return [];
      case 'TOKEN_EXPIRED':
        return [
          '**Claude Pro/Max**',
          'Sign-in expired — run `claude setup-token` to refresh.',
          '',
        ];
      default:
        return [
          '**Claude Pro/Max**',
          `Usage unavailable (${result.reason}).`,
          '',
        ];
    }
  }
  const { usage } = result;
  const lines: string[] = [
    `**Claude ${usage.subscriptionType ? usage.subscriptionType[0].toUpperCase() + usage.subscriptionType.slice(1) : 'Subscription'}**`,
  ];
  if (usage.fiveHour)
    lines.push(
      fmtLine('5 Hour', usage.fiveHour.usedPercent, usage.fiveHour.resetsAt),
    );
  if (usage.weekly)
    lines.push(
      fmtLine('Weekly', usage.weekly.usedPercent, usage.weekly.resetsAt),
    );
  if (usage.weeklyOpus)
    lines.push(
      fmtLine(
        'Weekly (Opus)',
        usage.weeklyOpus.usedPercent,
        usage.weeklyOpus.resetsAt,
      ),
    );
  if (usage.weeklySonnet)
    lines.push(
      fmtLine(
        'Weekly (Sonnet)',
        usage.weeklySonnet.usedPercent,
        usage.weeklySonnet.resetsAt,
      ),
    );
  for (const scoped of usage.scopedWeekly) {
    lines.push(
      fmtLine(`Weekly (${scoped.label})`, scoped.usedPercent, scoped.resetsAt),
    );
  }
  lines.push('');
  return lines;
}

async function renderOpenAICodexUsage(): Promise<string[]> {
  const providerPkg = await import('@plumb/provider');
  const registry = providerPkg.getPlumbProviderRegistry();
  const state = registry.getProviderState('openai-codex');
  if (
    !state ||
    state.authState !== 'authenticated' ||
    state.credentials?.type !== 'oauth'
  ) {
    return [];
  }
  const result = await providerPkg.fetchOpenAICodexUsage(state.credentials);
  if (!result.ok) {
    switch (result.reason) {
      case 'TOKEN_EXPIRED':
        return [
          '**ChatGPT Plus/Pro (Codex)**',
          'Sign-in expired — run `/login openai-codex` to refresh.',
          '',
        ];
      default:
        return [
          '**ChatGPT Plus/Pro (Codex)**',
          `Usage unavailable (${result.reason}).`,
          '',
        ];
    }
  }
  const { usage } = result;
  const lines: string[] = [
    `**ChatGPT ${usage.planType ? usage.planType[0].toUpperCase() + usage.planType.slice(1) : 'Plus/Pro'} (Codex)**`,
  ];
  if (usage.primary)
    lines.push(
      fmtLine('Primary', usage.primary.usedPercent, usage.primary.resetsAt),
    );
  if (usage.secondary)
    lines.push(
      fmtLine(
        'Secondary',
        usage.secondary.usedPercent,
        usage.secondary.resetsAt,
      ),
    );
  lines.push('');
  return lines;
}

// Display names for the generic vendored usage reporters (transports/
// genericVendorUsage.ts's GENERIC_VENDOR_USAGE_PROVIDER_IDS). Kept local to
// the command rather than in the catalog: these are display-only labels for
// a debug/quota view, not provider metadata other code depends on.
const GENERIC_PROVIDER_LABELS: Readonly<Record<string, string>> = {
  'github-copilot': 'GitHub Copilot',
  cursor: 'Cursor',
  'kimi-code': 'Kimi (Moonshot)',
  'xai-oauth': 'xAI (Grok)',
  umans: 'Umans',
  'opencode-go': 'OpenCode Go',
  'alibaba-token-plan': 'Alibaba Qwen (token plan)',
  'minimax-code': 'MiniMax',
  'zai-coding-plan': 'Z.AI / GLM',
  antigravity: 'Antigravity',
  'google-gemini-cli': 'Google Gemini CLI',
};

async function renderGenericVendorUsage(): Promise<string[]> {
  const providerPkg = await import('@plumb/provider');
  const registry = providerPkg.getPlumbProviderRegistry();
  const lines: string[] = [];

  for (const providerId of providerPkg.GENERIC_VENDOR_USAGE_PROVIDER_IDS) {
    const state = registry.getProviderState(providerId);
    if (!state || state.authState !== 'authenticated' || !state.credentials) {
      continue;
    }
    const result = await providerPkg
      .fetchGenericVendorUsage(providerId, state.credentials)
      .catch(() => ({ ok: false, reason: 'REQUEST_FAILED' }) as const);
    if (!result.ok) continue; // Silently skip providers with no usable report.

    const label = GENERIC_PROVIDER_LABELS[providerId] ?? providerId;
    const providerLines: string[] = [];
    for (const limit of result.report.limits) {
      const usedFraction = providerPkg.resolveUsedFraction(limit);
      if (usedFraction === undefined) continue;
      const windowLabel = limit.window?.label ?? limit.label;
      providerLines.push(
        fmtLine(windowLabel, usedFraction * 100, limit.window?.resetsAt),
      );
    }
    if (providerLines.length === 0) continue;
    lines.push(`**${label}**`, ...providerLines, '');
  }
  return lines;
}

export const quotaCommand: SlashCommand = {
  name: 'quota',
  altNames: ['limits'],
  description:
    'Show coding-plan/subscription 5-hour, weekly, and other usage limits',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  isSafeConcurrent: true,
  action: async (context: CommandContext) => {
    const [claudeLines, codexLines, genericLines] = await Promise.all([
      renderClaudeSubscriptionUsage().catch(() => []),
      renderOpenAICodexUsage().catch(() => []),
      renderGenericVendorUsage().catch(() => []),
    ]);
    const allLines = [...claudeLines, ...codexLines, ...genericLines];
    if (allLines.length === 0) {
      context.ui.addItem({
        type: MessageType.INFO,
        text: 'No coding-plan/subscription provider with usage reporting is connected. Use /plans to sign in.',
      });
      return;
    }
    context.ui.addItem({
      type: MessageType.INFO,
      text: allLines.join('\n').trimEnd(),
    });
  },
};

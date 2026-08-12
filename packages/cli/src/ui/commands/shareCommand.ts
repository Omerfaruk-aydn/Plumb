/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F16 (PLUMB-UI-DEVRIM-PROMPT.md), scoped to a local file -- see
 * sessionShareCard.ts's doc comment for why this isn't a QR-coded link.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  type CommandContext,
  type SlashCommand,
  type SlashCommandActionReturn,
  CommandKind,
} from './types.js';
import { SessionSelector } from '../../utils/sessionUtils.js';
import {
  summarizeSessionForShare,
  buildShareCardMarkdown,
} from '../utils/sessionShareCard.js';

export const shareCommand: SlashCommand = {
  name: 'share',
  description:
    'Write a local, human-readable summary card of this session (turns, files changed, duration) to a markdown file',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (
    context: CommandContext,
  ): Promise<SlashCommandActionReturn | void> => {
    const { ui } = context;
    const sessionId = context.services.agentContext?.config.getSessionId();
    if (!sessionId) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No active session found to share.',
      };
    }

    if (ui.pendingItem) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Operation already in progress, please wait.',
      };
    }

    try {
      const storage = context.services.agentContext!.config.storage;
      const sessionSelector = new SessionSelector(storage);
      const { sessionData } = await sessionSelector.resolveSession(sessionId);

      const summary = summarizeSessionForShare(sessionData);
      const markdown = buildShareCardMarkdown(summary);

      const args = context.invocation?.args.trim();
      const targetPath = args
        ? path.resolve(process.cwd(), args)
        : path.resolve(process.cwd(), `plumb-share-${summary.shortId}.md`);

      await fs.writeFile(targetPath, markdown, 'utf-8');

      return {
        type: 'message',
        messageType: 'info',
        content: `Session share card [${summary.shortId}] written to ${targetPath}`,
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to write session share card: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { debugLogger } from '@plumb/core';
import { copyToClipboard } from '../utils/commandUtils.js';
import { extractLastFencedCodeBlock } from '../utils/lastCodeBlock.js';
import {
  CommandKind,
  type SlashCommand,
  type SlashCommandActionReturn,
} from './types.js';

export const copyCommand: SlashCommand = {
  name: 'copy',
  description:
    'Copy the last result to clipboard. "copy code" copies just the last fenced code block.',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, args): Promise<SlashCommandActionReturn | void> => {
    const chat = context.services.agentContext?.geminiClient?.getChat();
    const history = chat?.getHistory();

    // Get the last message from the AI (model role)
    const lastAiMessage = history
      ? history.filter((item) => item.role === 'model').pop()
      : undefined;

    if (!lastAiMessage) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No output in history',
      };
    }
    // Extract text from the parts
    const lastAiOutput = lastAiMessage.parts
      ?.filter((part) => part.text)
      .map((part) => part.text)
      .join('');

    if (!lastAiOutput) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'Last AI output contains no text to copy.',
      };
    }

    // F2 (PLUMB-UI-DEVRIM-PROMPT.md): "/copy code" copies only the last
    // fenced code block from the last AI message, not the whole response.
    const wantsCodeOnly = args?.trim().toLowerCase() === 'code';
    let textToCopy = lastAiOutput;
    let notFoundMessage: SlashCommandActionReturn | undefined;
    if (wantsCodeOnly) {
      const block = extractLastFencedCodeBlock(lastAiOutput);
      if (!block) {
        notFoundMessage = {
          type: 'message',
          messageType: 'info',
          content: 'No code block found in the last AI output.',
        };
      } else {
        textToCopy = block.code;
      }
    }
    if (notFoundMessage) {
      return notFoundMessage;
    }

    try {
      const settings = context.services.settings.merged;
      await copyToClipboard(textToCopy, settings);

      return {
        type: 'message',
        messageType: 'info',
        content: wantsCodeOnly
          ? 'Last code block copied to the clipboard'
          : 'Last output copied to the clipboard',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debugLogger.debug(message);

      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to copy to the clipboard. ${message}`,
      };
    }
  },
  subCommands: [
    {
      name: 'code',
      description: 'Copy just the last fenced code block to clipboard',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: async (ctx) => copyCommand.action!(ctx, 'code'),
    },
  ],
};

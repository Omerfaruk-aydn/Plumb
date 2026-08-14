/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from './types.js';
import { MessageType } from '../types.js';

export const docsCommand: SlashCommand = {
  name: 'docs',
  description: 'Open PLUMB documentation in your browser',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context: CommandContext): Promise<void> => {
    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: 'No documentation URL is configured for this build.',
      },
      Date.now(),
    );
  },
};

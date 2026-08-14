/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CommandKind,
  type OpenDialogActionReturn,
  type SlashCommand,
} from './types.js';

export const themeCommand: SlashCommand = {
  name: 'theme',
  description: 'Change the theme',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: (_context, _args): OpenDialogActionReturn => ({
    type: 'dialog',
    dialog: 'theme',
  }),
};

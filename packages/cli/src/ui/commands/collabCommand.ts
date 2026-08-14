/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F21 (PLUMB-UI-DEVRIM-PROMPT.md): `/collab` starts (or stops) the local
 * read-only live-view server. `useCollabBridge` streams chat updates into it
 * once it's running; `CollabStatusBar` shows the live viewer count.
 */
import {
  CommandKind,
  type CommandContext,
  type SlashCommand,
} from './types.js';
import {
  getCollabServer,
  DEFAULT_COLLAB_PORT,
} from '../../collab/collabServer.js';

export const collabCommand: SlashCommand = {
  name: 'collab',
  description:
    'Start (or stop) a local read-only web view of this session: /collab or /collab stop',
  kind: CommandKind.BUILT_IN,
  action: async (_context: CommandContext, args: string) => {
    const server = getCollabServer();
    const trimmedArgs = args.trim().toLowerCase();

    if (trimmedArgs === 'stop') {
      if (!server.isRunning()) {
        return {
          type: 'message' as const,
          messageType: 'info' as const,
          content: 'Collab session is not running.',
        };
      }
      await server.stop();
      return {
        type: 'message' as const,
        messageType: 'info' as const,
        content: 'Collab session stopped.',
      };
    }

    if (server.isRunning()) {
      const { port } = server.getStatus();
      return {
        type: 'message' as const,
        messageType: 'info' as const,
        content: `Already broadcasting: localhost:${port} · /collab stop`,
      };
    }

    try {
      const status = await server.start(DEFAULT_COLLAB_PORT);
      return {
        type: 'message' as const,
        messageType: 'info' as const,
        content: `Broadcasting: localhost:${status.port} · /collab stop`,
      };
    } catch (error) {
      return {
        type: 'message' as const,
        messageType: 'error' as const,
        content: `Failed to start collab session: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
  },
};

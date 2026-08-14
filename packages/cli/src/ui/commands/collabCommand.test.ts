/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, afterEach } from 'vitest';
import { collabCommand } from './collabCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { getCollabServer } from '../../collab/collabServer.js';
import type { CommandContext } from './types.js';

describe('collabCommand', () => {
  const context = createMockCommandContext({}) as unknown as CommandContext;

  afterEach(async () => {
    await getCollabServer().stop();
  });

  it('starts the server and reports the broadcast URL', async () => {
    const result = await collabCommand.action!(context, '');
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: expect.stringContaining('Broadcasting: localhost:'),
    });
    expect(getCollabServer().isRunning()).toBe(true);
  });

  it('reports already-broadcasting instead of starting a second server', async () => {
    await collabCommand.action!(context, '');
    const port = getCollabServer().getStatus().port;

    const result = await collabCommand.action!(context, '');
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: `Already broadcasting: localhost:${port} · /collab stop`,
    });
  });

  it('stops a running session', async () => {
    await collabCommand.action!(context, '');
    expect(getCollabServer().isRunning()).toBe(true);

    const result = await collabCommand.action!(context, 'stop');
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'Collab session stopped.',
    });
    expect(getCollabServer().isRunning()).toBe(false);
  });

  it('reports nothing-to-stop when not running', async () => {
    const result = await collabCommand.action!(context, 'stop');
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'Collab session is not running.',
    });
  });
});

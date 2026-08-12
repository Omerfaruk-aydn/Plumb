/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shareCommand } from './shareCommand.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SessionSelector } from '../../utils/sessionUtils.js';
import type { CommandContext } from './types.js';
import { Storage, type ConversationRecord } from '@google/gemini-cli-core';
import { generateShortSessionId } from '../utils/sessionShareCard.js';

vi.mock('node:fs/promises');
vi.mock('../../utils/sessionUtils.js');

describe('shareCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Storage.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Storage.prototype, 'getProjectTempDir').mockReturnValue(
      path.join(path.sep, 'tmp', 'mock-dir'),
    );
    mockContext = {
      services: {
        agentContext: {
          config: {
            sessionId: 'test-session-id',
            getSessionId: () => 'test-session-id',
            storage: new Storage(process.cwd()),
          },
        },
      },
      invocation: {
        args: '',
        name: 'share',
        raw: '/share',
      },
      ui: {
        addItem: vi.fn(),
        setPendingItem: vi.fn(),
        pendingItem: null,
      },
    } as unknown as CommandContext;
  });

  it('should return error if sessionId is missing', async () => {
    mockContext.services.agentContext!.config.getSessionId = () =>
      undefined as unknown as string;
    const result = await shareCommand.action!(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'No active session found to share.',
    });
  });

  it('writes a share card to a default filename derived from the short session id', async () => {
    const mockSessionData: ConversationRecord = {
      sessionId: 'test-session-id',
      messages: [{ type: 'user', id: '1', timestamp: 't1', content: 'hi' }],
      projectHash: 'hash',
      startTime: '2026-01-01T00:00:00.000Z',
      lastUpdated: '2026-01-01T00:10:00.000Z',
    };
    vi.mocked(SessionSelector.prototype.resolveSession).mockResolvedValue({
      sessionData: mockSessionData,
      sessionPath: path.join(
        path.sep,
        'tmp',
        'mock-dir',
        'chats',
        'session.jsonl',
      ),
      displayInfo: 'test',
    });

    const result = await shareCommand.action!(mockContext, '');

    const shortId = generateShortSessionId('test-session-id');
    const expectedPath = path.resolve(
      process.cwd(),
      `plumb-share-${shortId}.md`,
    );

    expect(fs.writeFile).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining('# PLUMB Session Share Card'),
      'utf-8',
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining(shortId),
      'utf-8',
    );
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: expect.stringContaining(expectedPath),
    });
  });

  it('writes to an explicit path when args are given', async () => {
    mockContext.invocation!.args = '  ./card.md  ';
    vi.mocked(SessionSelector.prototype.resolveSession).mockResolvedValue({
      sessionData: {
        sessionId: 'test-session-id',
        messages: [],
        projectHash: 'hash',
        startTime: 't1',
        lastUpdated: 't2',
      },
      sessionPath: path.join(path.sep, 'tmp', 'session.jsonl'),
      displayInfo: 'test',
    });

    await shareCommand.action!(mockContext, '');

    expect(fs.writeFile).toHaveBeenCalledWith(
      path.resolve(process.cwd(), 'card.md'),
      expect.any(String),
      'utf-8',
    );
  });

  it('should return error if resolveSession fails', async () => {
    vi.mocked(SessionSelector.prototype.resolveSession).mockRejectedValue(
      new Error('Session not found'),
    );

    const result = await shareCommand.action!(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Failed to write session share card: Session not found',
    });
  });
});

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { ConversationRecord } from '@google/gemini-cli-core';
import {
  generateShortSessionId,
  summarizeSessionForShare,
  buildShareCardMarkdown,
} from './sessionShareCard.js';

describe('generateShortSessionId', () => {
  it('is deterministic for the same session id', () => {
    expect(generateShortSessionId('abc-123')).toBe(
      generateShortSessionId('abc-123'),
    );
  });

  it('differs for different session ids', () => {
    expect(generateShortSessionId('abc-123')).not.toBe(
      generateShortSessionId('abc-124'),
    );
  });

  it('is a fixed-length, uppercase label', () => {
    const id = generateShortSessionId('x');
    expect(id).toHaveLength(6);
    expect(id).toBe(id.toUpperCase());
  });
});

function conversation(
  overrides: Partial<ConversationRecord> = {},
): ConversationRecord {
  return {
    sessionId: 'test-session',
    projectHash: 'hash',
    startTime: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-01T00:05:00.000Z',
    messages: [],
    ...overrides,
  };
}

describe('summarizeSessionForShare', () => {
  it('counts user turns', () => {
    const summary = summarizeSessionForShare(
      conversation({
        messages: [
          { type: 'user', id: '1', timestamp: '1', content: 'a' },
          { type: 'gemini', id: '2', timestamp: '2', content: 'b' },
          { type: 'user', id: '3', timestamp: '3', content: 'c' },
        ],
      }),
    );
    expect(summary.turnCount).toBe(2);
  });

  it('aggregates file changes across gemini tool calls', () => {
    const diffStat = {
      model_added_lines: 3,
      model_removed_lines: 1,
      model_added_chars: 0,
      model_removed_chars: 0,
      user_added_lines: 0,
      user_removed_lines: 0,
      user_added_chars: 0,
      user_removed_chars: 0,
    };
    const summary = summarizeSessionForShare(
      conversation({
        messages: [
          { type: 'user', id: '1', timestamp: '1', content: 'edit a.ts' },
          {
            type: 'gemini',
            id: '2',
            timestamp: '2',
            content: 'done',
            toolCalls: [
              {
                resultDisplay: {
                  fileName: 'a.ts',
                  filePath: '/repo/a.ts',
                  fileDiff: 'diff',
                  diffStat,
                },
              },
            ],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ],
      }),
    );
    expect(summary.fileCount).toBe(1);
    expect(summary.addedLines).toBe(3);
    expect(summary.removedLines).toBe(1);
  });

  it('formats a human-readable duration from start/end timestamps', () => {
    const summary = summarizeSessionForShare(conversation());
    expect(summary.durationLabel).toBe('5 min');
  });

  it('falls back gracefully when timestamps are missing', () => {
    const summary = summarizeSessionForShare(
      conversation({ startTime: undefined, lastUpdated: undefined }),
    );
    expect(summary.durationLabel).toBe('unknown duration');
  });
});

describe('buildShareCardMarkdown', () => {
  it('includes every summary field', () => {
    const md = buildShareCardMarkdown({
      shortId: 'ABC123',
      turnCount: 4,
      fileCount: 2,
      addedLines: 10,
      removedLines: 3,
      durationLabel: '12 min',
    });
    expect(md).toContain('ABC123');
    expect(md).toContain('Turns:** 4');
    expect(md).toContain('Files changed:** 2');
    expect(md).toContain('+10 / -3');
    expect(md).toContain('12 min');
    expect(md).toContain('does not host or upload sessions');
  });
});

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import type { Config } from '@plumb/core';

const listInboxSkillsMock = vi.fn();
const listInboxPatchesMock = vi.fn();
const listInboxMemoryPatchesMock = vi.fn();
const dismissInboxSkillMock = vi.fn();
const dismissInboxPatchMock = vi.fn();
const dismissInboxMemoryPatchMock = vi.fn();
const writeFileMock = vi.fn();

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: (...args: unknown[]) => writeFileMock(...args),
  };
});

vi.mock('@plumb/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plumb/core')>();
  return {
    ...actual,
    listInboxSkills: (...args: unknown[]) => listInboxSkillsMock(...args),
    listInboxPatches: (...args: unknown[]) => listInboxPatchesMock(...args),
    listInboxMemoryPatches: (...args: unknown[]) =>
      listInboxMemoryPatchesMock(...args),
    dismissInboxSkill: (...args: unknown[]) => dismissInboxSkillMock(...args),
    dismissInboxPatch: (...args: unknown[]) => dismissInboxPatchMock(...args),
    dismissInboxMemoryPatch: (...args: unknown[]) =>
      dismissInboxMemoryPatchMock(...args),
  };
});

import {
  listMemoryRecords,
  deleteMemoryRecord,
  exportMemoryRecord,
  filterMemoryRecords,
  paginateMemoryRecords,
  type MemoryRecord,
} from './memoryRecords.js';

const mockConfig = {} as Config;

describe('listMemoryRecords', () => {
  beforeEach(() => {
    listInboxSkillsMock.mockReset();
    listInboxPatchesMock.mockReset();
    listInboxMemoryPatchesMock.mockReset();
  });

  it('merges skills, patches, and memory patches into one list, sorted newest first', async () => {
    listInboxSkillsMock.mockResolvedValue([
      {
        dirName: 'triage-bugs',
        name: 'Triage Bugs',
        description: 'How to triage incoming bugs',
        content: '# Triage Bugs\n...',
        extractedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    listInboxPatchesMock.mockResolvedValue([
      {
        fileName: 'update-docs.patch',
        name: 'update-docs',
        entries: [{ targetPath: '/a.md', diffContent: '--- a\n+++ b\n' }],
        extractedAt: '2026-03-01T00:00:00.000Z',
      },
    ]);
    listInboxMemoryPatchesMock.mockResolvedValue([
      {
        kind: 'private',
        relativePath: 'private',
        name: 'Private memory',
        entries: [
          {
            targetPath: '/MEMORY.md',
            diffContent: '--- old\n+++ new\n',
            isNewFile: false,
          },
        ],
        sourceFiles: ['a.patch'],
        extractedAt: '2026-02-01T00:00:00.000Z',
      },
    ]);

    const records = await listMemoryRecords(mockConfig);

    expect(records.map((r) => r.id)).toEqual([
      'patch:update-docs.patch', // March, newest
      'memory-patch:private', // February
      'skill:triage-bugs', // January, oldest
    ]);
    expect(records[2].content).toContain('Triage Bugs');
    expect(records[0].summary).toBe('1 file changed');
    expect(records[1].summary).toBe('1 pending change');
  });

  it('returns an empty list (empty state) when nothing is in the inbox', async () => {
    listInboxSkillsMock.mockResolvedValue([]);
    listInboxPatchesMock.mockResolvedValue([]);
    listInboxMemoryPatchesMock.mockResolvedValue([]);

    const records = await listMemoryRecords(mockConfig);
    expect(records).toEqual([]);
  });
});

describe('filterMemoryRecords', () => {
  const records: MemoryRecord[] = [
    {
      id: '1',
      kind: 'skill',
      label: 'Triage Bugs',
      summary: 'bug triage',
      date: null,
      content: '',
    },
    {
      id: '2',
      kind: 'patch',
      label: 'update-docs',
      summary: 'docs patch',
      date: null,
      content: '',
    },
  ];

  it('matches on label, summary, or kind (case-insensitive)', () => {
    expect(filterMemoryRecords(records, 'triage').map((r) => r.id)).toEqual([
      '1',
    ]);
    expect(filterMemoryRecords(records, 'DOCS').map((r) => r.id)).toEqual([
      '2',
    ]);
    expect(filterMemoryRecords(records, 'skill').map((r) => r.id)).toEqual([
      '1',
    ]);
    expect(filterMemoryRecords(records, '').map((r) => r.id)).toEqual([
      '1',
      '2',
    ]);
    expect(filterMemoryRecords(records, 'nonexistent')).toEqual([]);
  });
});

describe('paginateMemoryRecords', () => {
  const records: MemoryRecord[] = Array.from({ length: 1234 }, (_, i) => ({
    id: `r${i}`,
    kind: 'skill' as const,
    label: `record-${i}`,
    summary: '',
    date: null,
    content: '',
  }));

  it('paginates 1000+ records into fixed-size, non-overlapping pages', () => {
    const first = paginateMemoryRecords(records, 0, 20);
    expect(first.pageRecords).toHaveLength(20);
    expect(first.pageRecords[0].id).toBe('r0');
    expect(first.pageCount).toBe(Math.ceil(1234 / 20));

    const second = paginateMemoryRecords(records, 1, 20);
    expect(second.pageRecords[0].id).toBe('r20');

    const last = paginateMemoryRecords(records, 9999, 20);
    expect(last.clampedPage).toBe(first.pageCount - 1);
    expect(last.pageRecords.length).toBeGreaterThan(0);
  });
});

describe('deleteMemoryRecord', () => {
  beforeEach(() => {
    dismissInboxSkillMock
      .mockReset()
      .mockResolvedValue({ success: true, message: 'ok' });
    dismissInboxPatchMock
      .mockReset()
      .mockResolvedValue({ success: true, message: 'ok' });
    dismissInboxMemoryPatchMock
      .mockReset()
      .mockResolvedValue({ success: true, message: 'ok' });
  });

  it('routes each record kind to its matching dismiss function', async () => {
    await deleteMemoryRecord(mockConfig, {
      id: 'skill:triage-bugs',
      kind: 'skill',
      label: '',
      summary: '',
      date: null,
      content: '',
    });
    expect(dismissInboxSkillMock).toHaveBeenCalledWith(
      mockConfig,
      'triage-bugs',
    );

    await deleteMemoryRecord(mockConfig, {
      id: 'patch:update-docs.patch',
      kind: 'patch',
      label: '',
      summary: '',
      date: null,
      content: '',
    });
    expect(dismissInboxPatchMock).toHaveBeenCalledWith(
      mockConfig,
      'update-docs.patch',
    );

    await deleteMemoryRecord(mockConfig, {
      id: 'memory-patch:private',
      kind: 'memory-patch',
      label: '',
      summary: '',
      date: null,
      content: '',
    });
    expect(dismissInboxMemoryPatchMock).toHaveBeenCalledWith(
      mockConfig,
      'private',
      'private',
    );
  });

  it('reports a malformed-id failure without touching the filesystem for a corrupt record', async () => {
    const result = await deleteMemoryRecord(mockConfig, {
      id: 'not-a-valid-id',
      kind: 'skill',
      label: '',
      summary: '',
      date: null,
      content: '',
    });
    expect(result.success).toBe(false);
    expect(dismissInboxSkillMock).not.toHaveBeenCalled();
  });
});

describe('exportMemoryRecord', () => {
  it('writes the record content to a slugified file in the target directory', async () => {
    writeFileMock.mockReset().mockResolvedValue(undefined);

    const filePath = await exportMemoryRecord(
      {
        id: 'skill:triage-bugs',
        kind: 'skill',
        label: 'Triage Bugs!',
        summary: '',
        date: null,
        content: '# content',
      },
      '/tmp/export-dir',
    );

    expect(filePath).toBe(
      path.join('/tmp/export-dir', 'memory-export-triage-bugs.md'),
    );
    expect(writeFileMock).toHaveBeenCalledWith(filePath, '# content', 'utf-8');
  });
});

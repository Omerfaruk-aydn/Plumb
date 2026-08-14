/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F23 (PLUMB-UI-DEVRIM-PROMPT.md): adapter over PLUMB's real persistent
 * agent-memory layer -- the extraction-inbox records the auto-memory
 * background service (`packages/core/src/services/memoryService.ts`)
 * already writes and `/memory inbox` (InboxDialog) already reviews:
 * extracted skills, skill patches, and private/global memory patches.
 * `MemoryBrowser` is a read/filter/delete/export view over the SAME data,
 * via the SAME core list/dismiss functions InboxDialog uses -- no new
 * storage format, no invented state.
 *
 * Deliberately out of scope: PLUMB.md / context-memory content itself
 * (`/memory show`, `/memory reload`) is a single merged text blob per
 * scope, not a set of discrete records, so it doesn't fit a
 * list/filter/delete/export browser the way inbox entries do.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  type Config,
  listInboxSkills,
  listInboxPatches,
  listInboxMemoryPatches,
  dismissInboxSkill,
  dismissInboxPatch,
  dismissInboxMemoryPatch,
} from '@plumb/core';

export type MemoryRecordKind = 'skill' | 'patch' | 'memory-patch';

export interface MemoryRecord {
  id: string;
  kind: MemoryRecordKind;
  label: string;
  summary: string;
  date: Date | null;
  content: string;
}

export async function listMemoryRecords(
  config: Config,
): Promise<MemoryRecord[]> {
  const [skills, patches, memoryPatches] = await Promise.all([
    listInboxSkills(config),
    listInboxPatches(config),
    listInboxMemoryPatches(config),
  ]);

  const records: MemoryRecord[] = [];

  for (const skill of skills) {
    records.push({
      id: `skill:${skill.dirName}`,
      kind: 'skill',
      label: skill.name,
      summary: skill.description,
      date: skill.extractedAt ? new Date(skill.extractedAt) : null,
      content: skill.content,
    });
  }

  for (const patch of patches) {
    records.push({
      id: `patch:${patch.fileName}`,
      kind: 'patch',
      label: patch.name,
      summary: `${patch.entries.length} file${patch.entries.length === 1 ? '' : 's'} changed`,
      date: patch.extractedAt ? new Date(patch.extractedAt) : null,
      content: patch.entries.map((e) => e.diffContent).join('\n'),
    });
  }

  for (const memoryPatch of memoryPatches) {
    records.push({
      id: `memory-patch:${memoryPatch.kind}`,
      kind: 'memory-patch',
      label: memoryPatch.name,
      summary: `${memoryPatch.sourceFiles.length} pending change${memoryPatch.sourceFiles.length === 1 ? '' : 's'}`,
      date: memoryPatch.extractedAt ? new Date(memoryPatch.extractedAt) : null,
      content: memoryPatch.entries.map((e) => e.diffContent).join('\n'),
    });
  }

  records.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  return records;
}

function parseRecordId(
  id: string,
): { kind: MemoryRecordKind; key: string } | null {
  const separatorIndex = id.indexOf(':');
  if (separatorIndex === -1) return null;
  const kind = id.slice(0, separatorIndex);
  const key = id.slice(separatorIndex + 1);
  if (kind !== 'skill' && kind !== 'patch' && kind !== 'memory-patch') {
    return null;
  }
  return { kind, key };
}

export async function deleteMemoryRecord(
  config: Config,
  record: MemoryRecord,
): Promise<{ success: boolean; message: string }> {
  const parsed = parseRecordId(record.id);
  if (!parsed) {
    return { success: false, message: `Malformed record id: ${record.id}` };
  }

  switch (parsed.kind) {
    case 'skill':
      return dismissInboxSkill(config, parsed.key);
    case 'patch':
      return dismissInboxPatch(config, parsed.key);
    case 'memory-patch':
      if (parsed.key !== 'private' && parsed.key !== 'global') {
        return {
          success: false,
          message: `Unknown memory patch kind: ${parsed.key}`,
        };
      }
      return dismissInboxMemoryPatch(config, parsed.key, parsed.key);
    default:
      return { success: false, message: `Unknown record kind: ${record.id}` };
  }
}

function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'memory-record';
}

const EXTENSION_BY_KIND: Record<MemoryRecordKind, string> = {
  skill: 'md',
  patch: 'patch',
  'memory-patch': 'patch',
};

/** Writes a record's full content to a standalone file. Returns the path written to. */
export async function exportMemoryRecord(
  record: MemoryRecord,
  targetDir: string,
): Promise<string> {
  const fileName = `memory-export-${slugify(record.label)}.${EXTENSION_BY_KIND[record.kind]}`;
  const filePath = path.join(targetDir, fileName);
  await fs.writeFile(filePath, record.content, 'utf-8');
  return filePath;
}

export const MEMORY_BROWSER_PAGE_SIZE = 20;

export function paginateMemoryRecords(
  records: readonly MemoryRecord[],
  page: number,
  pageSize: number = MEMORY_BROWSER_PAGE_SIZE,
): { pageRecords: MemoryRecord[]; pageCount: number; clampedPage: number } {
  const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
  const clampedPage = Math.min(Math.max(0, page), pageCount - 1);
  const start = clampedPage * pageSize;
  return {
    pageRecords: records.slice(start, start + pageSize),
    pageCount,
    clampedPage,
  };
}

export function filterMemoryRecords(
  records: readonly MemoryRecord[],
  query: string,
): MemoryRecord[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...records];
  return records.filter(
    (r) =>
      r.label.toLowerCase().includes(trimmed) ||
      r.summary.toLowerCase().includes(trimmed) ||
      r.kind.toLowerCase().includes(trimmed),
  );
}

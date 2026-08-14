/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ConversationRecord,
  getFileDiffFromResultDisplay,
  computeModelAddedAndRemovedLines,
} from '@plumb/core';

export interface SessionShareSummary {
  shortId: string;
  turnCount: number;
  fileCount: number;
  addedLines: number;
  removedLines: number;
  durationLabel: string;
}

/** A short, deterministic, human-shareable label derived from the real
 * session id -- not cryptographic, not unique-guaranteed, just something
 * two people can read aloud to confirm they mean the same session. */
export function generateShortSessionId(sessionId: string): string {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

function formatDuration(start?: string, end?: string): string {
  if (!start || !end) return 'unknown duration';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'unknown duration';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

export function summarizeSessionForShare(
  conversation: ConversationRecord,
): SessionShareSummary {
  const turnCount = conversation.messages.filter(
    (m) => m.type === 'user',
  ).length;

  const files = new Set<string>();
  let addedLines = 0;
  let removedLines = 0;
  for (const msg of conversation.messages) {
    if (msg.type !== 'gemini' || !msg.toolCalls) continue;
    for (const toolCall of msg.toolCalls) {
      const fileDiff = getFileDiffFromResultDisplay(toolCall.resultDisplay);
      if (!fileDiff) continue;
      files.add(fileDiff.fileName);
      const calc = computeModelAddedAndRemovedLines(fileDiff.diffStat);
      addedLines += calc.addedLines;
      removedLines += calc.removedLines;
    }
  }

  return {
    shortId: generateShortSessionId(conversation.sessionId),
    turnCount,
    fileCount: files.size,
    addedLines,
    removedLines,
    durationLabel: formatDuration(
      conversation.startTime,
      conversation.lastUpdated,
    ),
  };
}

export function buildShareCardMarkdown(summary: SessionShareSummary): string {
  return [
    '# PLUMB Session Share Card',
    '',
    `**ID:** ${summary.shortId}`,
    `**Turns:** ${summary.turnCount}`,
    `**Duration:** ${summary.durationLabel}`,
    `**Files changed:** ${summary.fileCount}`,
    `**Lines:** +${summary.addedLines} / -${summary.removedLines}`,
    '',
    '_Generated locally by PLUMB CLI. Sharing this means sending this file to someone -- PLUMB does not host or upload sessions._',
    '',
  ].join('\n');
}

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Content } from '@google/genai';
import { EDIT_TOOL_NAMES } from '../tools/tool-names.js';
import { READ_FILE_TOOL_NAME } from '../tools/definitions/base-declarations.js';

export interface StaleReadMarkingResult {
  newHistory: Content[];
  markedCount: number;
}

const STALE_READ_NOTICE =
  'This file was read here, but has since been modified by a later edit. ' +
  'Re-read it if you need the current content.';

interface TrackedCall {
  id: string;
  path: string;
  index: number;
}

interface TrackedResponse {
  id: string;
  contentIndex: number;
  partIndex: number;
}

/**
 * Marks `read_file` results as stale once a later `Edit`/`WriteFile` call
 * touches the same path -- a correctness fix, not a cost optimization
 * (compare `ToolOutputMaskingService`, which prunes purely by token budget).
 * Without this, a file the model read three turns ago still looks exactly
 * as current as anything else in history, and nothing stops it from acting
 * on content that no longer exists on disk.
 *
 * Deliberately scoped to `read_file` only, not grep/glob: a `read_file` call
 * carries one exact path and its response is the literal file content, both
 * a precise signal and a precise target. Grep/glob's directory-scoped,
 * multi-file results have no single clean path to correlate.
 *
 * Marks on any later edit to the same path regardless of whether that edit
 * ultimately succeeded -- whether a specific attempt failed isn't reliably
 * recoverable from the serialized function-response text, and erring toward
 * "mark it stale" is the safe direction: a false positive costs one re-read
 * tool call, a false negative risks the model confidently acting on content
 * that's actually gone.
 */
export function markStaleReads(
  history: readonly Content[],
): StaleReadMarkingResult {
  const reads: TrackedCall[] = [];
  const edits: TrackedCall[] = [];
  const responsesById = new Map<string, TrackedResponse>();

  history.forEach((content, contentIndex) => {
    content.parts?.forEach((part, partIndex) => {
      const call = part.functionCall;
      if (call?.id && call.name) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const filePath = call.args?.['file_path'] as string | undefined;
        if (typeof filePath === 'string' && filePath.length > 0) {
          const entry: TrackedCall = {
            id: call.id,
            path: filePath,
            index: contentIndex,
          };
          if (call.name === READ_FILE_TOOL_NAME) {
            reads.push(entry);
          } else if (EDIT_TOOL_NAMES.has(call.name)) {
            edits.push(entry);
          }
        }
      }

      const responseId = part.functionResponse?.id;
      if (responseId && !responsesById.has(responseId)) {
        responsesById.set(responseId, {
          id: responseId,
          contentIndex,
          partIndex,
        });
      }
    });
  });

  if (reads.length === 0 || edits.length === 0) {
    return { newHistory: [...history], markedCount: 0 };
  }

  const newHistory = history.map((content) => ({
    ...content,
    parts: content.parts ? [...content.parts] : content.parts,
  }));
  let markedCount = 0;

  for (const read of reads) {
    const isStale = edits.some(
      (edit) => edit.path === read.path && edit.index > read.index,
    );
    if (!isStale) continue;

    const response = responsesById.get(read.id);
    if (!response) continue;

    const target = newHistory[response.contentIndex];
    const part = target.parts?.[response.partIndex];
    if (!part?.functionResponse) continue;

    // Idempotent: already-marked reads carry this exact notice.
    const existing = part.functionResponse.response;
    if (existing?.['output'] === STALE_READ_NOTICE) continue;

    target.parts![response.partIndex] = {
      ...part,
      functionResponse: {
        // eslint-disable-next-line @typescript-eslint/no-misused-spread
        ...part.functionResponse,
        response: { output: STALE_READ_NOTICE },
      },
    };
    markedCount++;
  }

  return { newHistory, markedCount };
}

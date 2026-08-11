/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F2 (PLUMB-UI-DEVRIM-PROMPT.md): "copy the code, not the whole message."
 * Pure extraction, no rendering -- reused by /copy code and any future
 * code-block action.
 */

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)[ \t]*$/;

/**
 * Returns the content of the LAST fenced code block in `text` (the most
 * recent one a user would actually mean by "the code"), or `null` when
 * there is none. Matches ``` and ~~~ fences of length >= 3, same as
 * MarkdownDisplay's own fence detection.
 */
export function extractLastFencedCodeBlock(
  text: string,
): { language: string | null; code: string } | null {
  const lines = text.split(/\r?\n/);

  let lastBlock: { language: string | null; code: string } | null = null;
  let inBlock = false;
  let fenceChar = '';
  let fenceLen = 0;
  let currentLang: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(FENCE_LINE);
    if (!inBlock) {
      if (match) {
        inBlock = true;
        fenceChar = match[1][0];
        fenceLen = match[1].length;
        currentLang = match[2] || null;
        currentLines = [];
      }
      continue;
    }

    // Inside a block: only a fence of the same character and >= length closes it.
    if (match && match[1][0] === fenceChar && match[1].length >= fenceLen) {
      lastBlock = { language: currentLang, code: currentLines.join('\n') };
      inBlock = false;
      continue;
    }
    currentLines.push(line);
  }

  return lastBlock;
}

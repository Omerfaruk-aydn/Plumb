/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { Content } from '@google/genai';
import { markStaleReads } from './staleResultMarking.js';

function readCall(id: string, filePath: string): Content {
  return {
    role: 'model',
    parts: [
      {
        functionCall: { id, name: 'read_file', args: { file_path: filePath } },
      },
    ],
  };
}

function readResponse(id: string, output: string): Content {
  return {
    role: 'user',
    parts: [
      { functionResponse: { id, name: 'read_file', response: { output } } },
    ],
  };
}

function editCall(id: string, filePath: string): Content {
  return {
    role: 'model',
    parts: [
      { functionCall: { id, name: 'replace', args: { file_path: filePath } } },
    ],
  };
}

function editResponse(id: string): Content {
  return {
    role: 'user',
    parts: [
      { functionResponse: { id, name: 'replace', response: { output: 'ok' } } },
    ],
  };
}

describe('markStaleReads', () => {
  it('marks a read as stale when a later edit touches the same path', () => {
    const history: Content[] = [
      readCall('r1', 'src/a.ts'),
      readResponse('r1', 'original content'),
      editCall('e1', 'src/a.ts'),
      editResponse('e1'),
    ];

    const { newHistory, markedCount } = markStaleReads(history);

    expect(markedCount).toBe(1);
    const marked = newHistory[1].parts![0].functionResponse!.response as {
      output: string;
    };
    expect(marked.output).toContain('since been modified');
    expect(marked.output).not.toContain('original content');
  });

  it('leaves a read untouched when the file is never edited', () => {
    const history: Content[] = [
      readCall('r1', 'src/a.ts'),
      readResponse('r1', 'original content'),
    ];

    const { newHistory, markedCount } = markStaleReads(history);

    expect(markedCount).toBe(0);
    const response = newHistory[1].parts![0].functionResponse!.response as {
      output: string;
    };
    expect(response.output).toBe('original content');
  });

  it('leaves a read untouched when the edit is to a different path', () => {
    const history: Content[] = [
      readCall('r1', 'src/a.ts'),
      readResponse('r1', 'original content'),
      editCall('e1', 'src/b.ts'),
      editResponse('e1'),
    ];

    const { markedCount } = markStaleReads(history);
    expect(markedCount).toBe(0);
  });

  it('leaves a read untouched when the edit happened before the read', () => {
    const history: Content[] = [
      editCall('e1', 'src/a.ts'),
      editResponse('e1'),
      readCall('r1', 'src/a.ts'),
      readResponse('r1', 'content after the edit'),
    ];

    const { markedCount } = markStaleReads(history);
    expect(markedCount).toBe(0);
  });

  it('marks every earlier read of a repeatedly-read, then-edited file', () => {
    const history: Content[] = [
      readCall('r1', 'src/a.ts'),
      readResponse('r1', 'v1'),
      readCall('r2', 'src/a.ts'),
      readResponse('r2', 'v1 again'),
      editCall('e1', 'src/a.ts'),
      editResponse('e1'),
    ];

    const { markedCount } = markStaleReads(history);
    expect(markedCount).toBe(2);
  });

  it('is idempotent -- a second pass does not re-mark or double-wrap', () => {
    const history: Content[] = [
      readCall('r1', 'src/a.ts'),
      readResponse('r1', 'original content'),
      editCall('e1', 'src/a.ts'),
      editResponse('e1'),
    ];

    const first = markStaleReads(history);
    const second = markStaleReads(first.newHistory);

    expect(second.markedCount).toBe(0);
    const response = second.newHistory[1].parts![0].functionResponse!
      .response as { output: string };
    expect(response.output).toContain('since been modified');
  });

  it('returns the original history unchanged when there are no reads or edits', () => {
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hello' }] }];
    const { newHistory, markedCount } = markStaleReads(history);
    expect(markedCount).toBe(0);
    expect(newHistory).toEqual(history);
  });
});

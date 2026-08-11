/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { extractLastFencedCodeBlock } from './lastCodeBlock.js';

describe('extractLastFencedCodeBlock', () => {
  it('returns null when there is no fenced code block', () => {
    expect(extractLastFencedCodeBlock('just plain text')).toBeNull();
  });

  it('extracts a single labeled code block', () => {
    const text = ['Here:', '```typescript', 'const x = 1;', '```'].join('\n');
    expect(extractLastFencedCodeBlock(text)).toEqual({
      language: 'typescript',
      code: 'const x = 1;',
    });
  });

  it('returns the LAST block, not the first, when there are multiple', () => {
    const text = [
      '```js',
      'first();',
      '```',
      'some text between',
      '```python',
      'second()',
      '```',
    ].join('\n');
    expect(extractLastFencedCodeBlock(text)).toEqual({
      language: 'python',
      code: 'second()',
    });
  });

  it('returns null language for an unlabeled fence', () => {
    const text = ['```', 'plain code', '```'].join('\n');
    expect(extractLastFencedCodeBlock(text)).toEqual({
      language: null,
      code: 'plain code',
    });
  });

  it('preserves multi-line code content exactly, including blank lines', () => {
    const text = [
      '```ts',
      'function f() {',
      '',
      '  return 1;',
      '}',
      '```',
    ].join('\n');
    expect(extractLastFencedCodeBlock(text)).toEqual({
      language: 'ts',
      code: 'function f() {\n\n  return 1;\n}',
    });
  });

  it('does not treat an unclosed fence as a block', () => {
    const text = ['```ts', 'const x = 1;'].join('\n');
    expect(extractLastFencedCodeBlock(text)).toBeNull();
  });

  it('supports tilde fences', () => {
    const text = ['~~~yaml', 'key: value', '~~~'].join('\n');
    expect(extractLastFencedCodeBlock(text)).toEqual({
      language: 'yaml',
      code: 'key: value',
    });
  });
});

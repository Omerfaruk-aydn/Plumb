/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest/globals" />

import { expect, type Assertion } from 'vitest';
import path from 'node:path';
import stripAnsi from 'strip-ansi';
import type { TextBuffer } from '../ui/components/shared/text-buffer.js';

// RegExp to detect invalid characters: backspace, and ANSI escape codes
// eslint-disable-next-line no-control-regex
const invalidCharsRegex = /[\b\x1b]/;

const callCountByTest = new Map<string, number>();

export async function toMatchSvgSnapshot(
  this: Assertion,
  renderInstance: {
    lastFrameRaw?: (options?: { allowEmpty?: boolean }) => string;
    lastFrame?: (options?: { allowEmpty?: boolean }) => string;
    generateSvg: () => string;
  },
  options?: { allowEmpty?: boolean; name?: string },
) {
  const currentTestName = expect.getState().currentTestName;
  if (!currentTestName) {
    throw new Error('toMatchSvgSnapshot must be called within a test');
  }
  const testPath = expect.getState().testPath;
  if (!testPath) {
    throw new Error('toMatchSvgSnapshot requires testPath');
  }

  let textContent: string;
  if (renderInstance.lastFrameRaw) {
    textContent = renderInstance.lastFrameRaw({
      allowEmpty: options?.allowEmpty,
    });
  } else if (renderInstance.lastFrame) {
    textContent = renderInstance.lastFrame({ allowEmpty: options?.allowEmpty });
  } else {
    throw new Error(
      'toMatchSvgSnapshot requires a renderInstance with either lastFrameRaw or lastFrame',
    );
  }
  const svgContent = renderInstance.generateSvg().replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '⠋');

  const sanitize = (name: string) =>
    name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');

  const testId = testPath + ':' + currentTestName;
  let count = callCountByTest.get(testId) ?? 0;
  count++;
  callCountByTest.set(testId, count);

  const snapshotName =
    options?.name ??
    (count > 1 ? `${currentTestName}-${count}` : currentTestName);

  const svgFileName =
    sanitize(path.basename(testPath).replace(/\.test\.tsx?$/, '')) +
    '-' +
    sanitize(snapshotName) +
    '.snap.svg';
  const svgDir = path.join(path.dirname(testPath), '__snapshots__');
  const svgFilePath = path.join(svgDir, svgFileName);

  // Assert the text matches standard snapshot, stripping ANSI for stability
  expect(
    stripAnsi(textContent).replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '⠋'),
  ).toMatchSnapshot();

  const snapshotState = (
    expect.getState() as unknown as {
      snapshotState?: {
        _updateSnapshot?: string;
        snapshotOptions?: { updateSnapshot?: string };
      };
    }
  ).snapshotState;
  const isUpdate =
    snapshotState?._updateSnapshot === 'all' ||
    snapshotState?.snapshotOptions?.updateSnapshot === 'all' ||
    process.argv.includes('-u') ||
    process.argv.includes('--update') ||
    Boolean(process.env['UPDATE_SNAPSHOTS']);

  if (isUpdate) {
    try {
      const fs = await import('node:fs');
      fs.mkdirSync(svgDir, { recursive: true });
      fs.writeFileSync(svgFilePath, svgContent, 'utf-8');
    } catch {
      // Ignore concurrent file write lock errors during parallel Vitest runs
    }
  }

  // Assert the SVG matches the file snapshot
  await expect(svgContent).toMatchFileSnapshot(svgFilePath);

  return { pass: true, message: () => '' };
}

function toHaveOnlyValidCharacters(buffer: TextBuffer) {
  let pass = true;
  const invalidLines: Array<{ line: number; content: string }> = [];

  for (let i = 0; i < buffer.lines.length; i++) {
    const line = buffer.lines[i];
    if (line.includes('\n')) {
      pass = false;
      invalidLines.push({ line: i, content: line });
      break; // Fail fast on newlines
    }
    if (invalidCharsRegex.test(line)) {
      pass = false;
      invalidLines.push({ line: i, content: line });
    }
  }

  return {
    pass,
    message: () =>
      `Expected buffer to have only valid characters, but found invalid characters in lines:\n${invalidLines
        .map((l) => `  [${l.line}]: "${l.content}"`)
        .join('\n')}`,
    actual: buffer.lines,
    expected: 'Lines with no line breaks, backspaces, or escape codes.',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toMatchSvgSnapshotMatcher: any = toMatchSvgSnapshot;

expect.extend({
  toHaveOnlyValidCharacters,
  toMatchSvgSnapshot: toMatchSvgSnapshotMatcher,
});

// Extend Vitest's `expect` interface with the custom matcher's type definition.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends CustomMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends CustomMatchers {}

  interface CustomMatchers<T = unknown> {
    toHaveOnlyValidCharacters(): T;
    toMatchSvgSnapshot(options?: {
      allowEmpty?: boolean;
      name?: string;
    }): Promise<void>;
  }
}

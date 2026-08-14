/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTEXT_FILENAME,
  getAllContextFilenames,
  resetContextFilename,
  setContextFilename,
} from './memoryTool.js';

describe('memoryTool filename helpers', () => {
  afterEach(() => {
    resetContextFilename(DEFAULT_CONTEXT_FILENAME);
  });

  describe('setContextFilename', () => {
    it('appends to currentContextFilename when a valid new name is provided', () => {
      const newName = 'CUSTOM_CONTEXT.md';
      setContextFilename(newName);
      expect(getAllContextFilenames()).toEqual([
        newName,
        DEFAULT_CONTEXT_FILENAME,
      ]);
    });

    it('does not update currentContextFilename if the new name is empty or whitespace', () => {
      const initialNames = getAllContextFilenames();
      setContextFilename('  ');
      expect(getAllContextFilenames()).toEqual(initialNames);

      setContextFilename('');
      expect(getAllContextFilenames()).toEqual(initialNames);
    });

    it('handles adding an array of filenames', () => {
      const newNames = ['CUSTOM_CONTEXT.md', 'ANOTHER_CONTEXT.md'];
      setContextFilename(newNames);
      expect(getAllContextFilenames()).toEqual([
        ...newNames,
        DEFAULT_CONTEXT_FILENAME,
      ]);
    });

    it('ensures uniqueness when adding names', () => {
      setContextFilename(DEFAULT_CONTEXT_FILENAME);
      expect(getAllContextFilenames()).toEqual([DEFAULT_CONTEXT_FILENAME]);

      setContextFilename(['NEW.md', 'NEW.md']);
      expect(getAllContextFilenames()).toEqual([
        'NEW.md',
        DEFAULT_CONTEXT_FILENAME,
      ]);
    });
  });

  describe('resetContextFilename', () => {
    it('replaces all filenames with the provided one', () => {
      setContextFilename('OTHER.md');
      resetContextFilename('RESET.md');
      expect(getAllContextFilenames()).toEqual(['RESET.md']);
    });

    it('resets to default if no argument provided', () => {
      resetContextFilename('OTHER.md');
      resetContextFilename(DEFAULT_CONTEXT_FILENAME);
      expect(getAllContextFilenames()).toEqual([DEFAULT_CONTEXT_FILENAME]);
    });

    it('handles array reset', () => {
      resetContextFilename(['A.md', 'B.md']);
      expect(getAllContextFilenames()).toEqual(['A.md', 'B.md']);
    });
  });
});

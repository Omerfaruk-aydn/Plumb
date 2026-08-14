/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { docsCommand } from './docsCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';

describe('docsCommand', () => {
  let mockContext: CommandContext;
  beforeEach(() => {
    mockContext = createMockCommandContext();
  });

  it('reports that no documentation URL is configured', async () => {
    if (!docsCommand.action) {
      throw new Error('docsCommand must have an action.');
    }

    await docsCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.INFO,
        text: 'No documentation URL is configured for this build.',
      },
      expect.any(Number),
    );
  });
});

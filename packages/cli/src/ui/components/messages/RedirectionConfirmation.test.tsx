/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { ToolConfirmationMessage } from './ToolConfirmationMessage.js';
import type { SerializableConfirmationDetails, Config } from '@plumb/core';
import { initializeShellParsers } from '@plumb/core';
import { renderWithProviders } from '../../../test-utils/render.js';

describe('ToolConfirmationMessage Redirection', { timeout: 30000 }, () => {
  beforeAll(async () => {
    await initializeShellParsers();
  });

  const mockConfig = {
    isTrustedFolder: () => true,
    getIdeMode: () => false,
    getDisableAlwaysAllow: () => false,
    getApprovalMode: () => 'default',
  } as unknown as Config;

  it('should display redirection warning and tip for redirected commands', async () => {
    const confirmationDetails: SerializableConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Shell Command',
      command: 'echo "hello" > test.txt',
      rootCommand: 'echo, redirection (>)',
      rootCommands: ['echo'],
    };

    const { lastFrame, unmount } = await renderWithProviders(
      <ToolConfirmationMessage
        callId="test-call-id"
        confirmationDetails={confirmationDetails}
        config={mockConfig}
        getPreferredEditor={vi.fn()}
        availableTerminalHeight={30}
        terminalWidth={100}
        toolName="shell"
      />,
    );

    const output = lastFrame();
    expect(output).toMatchSnapshot();
    unmount();
  });
});

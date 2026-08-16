/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  renderWithProviders,
  persistentStateMock,
} from '../../test-utils/render.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlternateBufferQuittingDisplay } from './AlternateBufferQuittingDisplay.js';
import type { HistoryItem, HistoryItemWithoutId } from '../types.js';
import { Text } from 'ink';
import { CoreToolCallStatus } from '@plumb/core';

vi.mock('../utils/terminalSetup.js', () => ({
  getTerminalProgram: () => null,
}));

vi.mock('../contexts/AppContext.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../contexts/AppContext.js')>();
  return {
    ...actual,
    useAppContext: () => ({
      version: '0.10.0',
    }),
  };
});

vi.mock('@plumb/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plumb/core')>();
  return {
    ...actual,
    getMCPServerStatus: vi.fn(),
  };
});

vi.mock('../PlumbRespondingSpinner.js', () => ({
  PlumbRespondingSpinner: () => <Text>Spinner</Text>,
}));

const mockHistory: HistoryItem[] = [
  {
    id: 1,
    type: 'tool_group',
    tools: [
      {
        callId: 'call1',
        name: 'tool1',
        description: 'Description for tool 1',
        status: CoreToolCallStatus.Success,
        resultDisplay: undefined,
        confirmationDetails: undefined,
      },
    ],
  },
  {
    id: 2,
    type: 'tool_group',
    tools: [
      {
        callId: 'call2',
        name: 'tool2',
        description: 'Description for tool 2',
        status: CoreToolCallStatus.Success,
        resultDisplay: undefined,
        confirmationDetails: undefined,
      },
    ],
  },
];

const mockPendingHistoryItems: HistoryItemWithoutId[] = [
  {
    type: 'tool_group',
    tools: [
      {
        callId: 'call3',
        name: 'tool3',
        description: 'Description for tool 3',
        status: CoreToolCallStatus.Scheduled,
        resultDisplay: undefined,
        confirmationDetails: undefined,
      },
    ],
  },
];

describe('AlternateBufferQuittingDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The header greets the user based on the wall clock, so these
    // snapshots silently depended on what time of day the suite ran.
    // Pin the clock so the greeting is a fixed input, not an ambient one.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T14:30:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });
  const baseUIState = {
    terminalWidth: 80,
    mainAreaWidth: 80,
    slashCommands: [],
    activePtyId: undefined,
    embeddedShellFocused: false,
    renderMarkdown: false,
    bannerData: {
      defaultText: '',
      warningText: '',
    },
  };

  it('renders with active and pending tool messages', async () => {
    persistentStateMock.setData({ tipsShown: 0 });
    const { lastFrame, unmount } = await renderWithProviders(
      <AlternateBufferQuittingDisplay />,
      {
        uiState: {
          ...baseUIState,
          history: mockHistory,
          pendingHistoryItems: mockPendingHistoryItems,
        },
      },
    );
    expect(lastFrame()).toMatchSnapshot('with_history_and_pending');
    unmount();
  });

  it('renders with empty history and no pending items', async () => {
    persistentStateMock.setData({ tipsShown: 0 });
    const { lastFrame, unmount } = await renderWithProviders(
      <AlternateBufferQuittingDisplay />,
      {
        uiState: {
          ...baseUIState,
          history: [],
          pendingHistoryItems: [],
        },
      },
    );
    expect(lastFrame()).toMatchSnapshot('empty');
    unmount();
  });

  it('renders with history but no pending items', async () => {
    persistentStateMock.setData({ tipsShown: 0 });
    const { lastFrame, unmount } = await renderWithProviders(
      <AlternateBufferQuittingDisplay />,
      {
        uiState: {
          ...baseUIState,
          history: mockHistory,
          pendingHistoryItems: [],
        },
      },
    );
    expect(lastFrame()).toMatchSnapshot('with_history_no_pending');
    unmount();
  });

  it('renders with pending items but no history', async () => {
    persistentStateMock.setData({ tipsShown: 0 });
    const { lastFrame, unmount } = await renderWithProviders(
      <AlternateBufferQuittingDisplay />,
      {
        uiState: {
          ...baseUIState,
          history: [],
          pendingHistoryItems: mockPendingHistoryItems,
        },
      },
    );
    expect(lastFrame()).toMatchSnapshot('with_pending_no_history');
    unmount();
  });

  it('renders with a tool awaiting confirmation', async () => {
    persistentStateMock.setData({ tipsShown: 0 });
    const pendingHistoryItems: HistoryItemWithoutId[] = [
      {
        type: 'tool_group',
        tools: [
          {
            callId: 'call4',
            name: 'confirming_tool',
            description: 'Confirming tool description',
            status: CoreToolCallStatus.AwaitingApproval,
            resultDisplay: undefined,
            confirmationDetails: {
              type: 'info',
              title: 'Confirm Tool',
              prompt: 'Confirm this action?',
            },
          },
        ],
      },
    ];
    const { lastFrame, unmount } = await renderWithProviders(
      <AlternateBufferQuittingDisplay />,
      {
        uiState: {
          ...baseUIState,
          history: [],
          pendingHistoryItems,
        },
      },
    );
    const output = lastFrame();
    expect(output).toContain('Action Required (was prompted):');
    expect(output).toContain('confirming_tool');
    expect(output).toContain('Confirming tool description');
    expect(output).toMatchSnapshot('with_confirming_tool');
    unmount();
  });

  it('renders with user and gemini messages', async () => {
    persistentStateMock.setData({ tipsShown: 0 });
    const history: HistoryItem[] = [
      { id: 1, type: 'user', text: 'Hello Gemini' },
      { id: 2, type: 'plumb', text: 'Hello User!' },
    ];
    const { lastFrame, unmount } = await renderWithProviders(
      <AlternateBufferQuittingDisplay />,
      {
        uiState: {
          ...baseUIState,
          history,
          pendingHistoryItems: [],
        },
      },
    );
    const frame = lastFrame().replace(/\b\d{2}:\d{2}\b/g, '12:00');
    expect(frame).toMatchSnapshot('with_user_gemini_messages');
    unmount();
  });
});

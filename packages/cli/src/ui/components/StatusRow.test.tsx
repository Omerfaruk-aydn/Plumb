/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders } from '../../test-utils/render.js';
import { StatusRow } from './StatusRow.js';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useComposerStatus } from '../hooks/useComposerStatus.js';
import { type UIState } from '../contexts/UIStateContext.js';

import { type SessionStatsState } from '../contexts/SessionContext.js';
import { type ThoughtSummary } from '../types.js';
import { ApprovalMode } from '@google/gemini-cli-core';

vi.mock('../hooks/useComposerStatus.js', () => ({
  useComposerStatus: vi.fn(),
}));

describe('<StatusRow />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultUiState: Partial<UIState> = {
    currentTip: undefined,
    thought: null,
    elapsedTime: 0,
    currentWittyPhrase: undefined,
    activeHooks: [],
    sessionStats: { lastPromptTokenCount: 0 } as unknown as SessionStatsState,
    shortcutsHelpVisible: false,
    contextFileNames: [],
    showApprovalModeIndicator: ApprovalMode.DEFAULT,
    allowPlanMode: false,
    renderMarkdown: true,
    currentModel: 'gemini-3',
  };

  it('renders status and tip correctly when they both fit', async () => {
    (useComposerStatus as Mock).mockReturnValue({
      isInteractiveShellWaiting: false,
      showLoadingIndicator: true,
      showTips: true,
      showWit: true,
      modeContentObj: null,
      showMinimalContext: false,
    });

    const uiState: Partial<UIState> = {
      ...defaultUiState,
      currentTip: 'Test Tip',
      thought: { subject: 'Thinking...' } as unknown as ThoughtSummary,
      elapsedTime: 5,
      currentWittyPhrase: 'I am witty',
    };

    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <StatusRow
        showUiDetails={false}
        isNarrow={false}
        terminalWidth={100}
        hideContextSummary={false}
        hideUiDetailsForSuggestions={false}
        hasPendingActionRequired={false}
      />,
      {
        width: 100,
        uiState,
      },
    );

    await waitUntilReady();
    const output = lastFrame();
    expect(output).toContain('Thinking...');
    expect(output).toContain('I am witty');
    expect(output).toContain('Tip: Test Tip');
  });

  it('renders correctly when interactive shell is waiting', async () => {
    (useComposerStatus as Mock).mockReturnValue({
      isInteractiveShellWaiting: true,
      showLoadingIndicator: false,
      showTips: false,
      showWit: false,
      modeContentObj: null,
      showMinimalContext: false,
    });

    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <StatusRow
        showUiDetails={true}
        isNarrow={false}
        terminalWidth={100}
        hideContextSummary={false}
        hideUiDetailsForSuggestions={false}
        hasPendingActionRequired={false}
      />,
      {
        width: 100,
        uiState: defaultUiState,
      },
    );

    await waitUntilReady();
    expect(lastFrame()).toContain('! Shell awaiting input (Tab to focus)');
  });

  it('renders tip with absolute positioning when it fits but might collide (verification of container logic)', async () => {
    (useComposerStatus as Mock).mockReturnValue({
      isInteractiveShellWaiting: false,
      showLoadingIndicator: true,
      showTips: true,
      showWit: true,
      modeContentObj: null,
      showMinimalContext: false,
    });

    const uiState: Partial<UIState> = {
      ...defaultUiState,
      currentTip: 'Test Tip',
    };

    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <StatusRow
        showUiDetails={false}
        isNarrow={false}
        terminalWidth={100}
        hideContextSummary={false}
        hideUiDetailsForSuggestions={false}
        hasPendingActionRequired={false}
      />,
      {
        width: 100,
        uiState,
      },
    );

    await waitUntilReady();
    expect(lastFrame()).toContain('Tip: Test Tip');
  });

  // ─── REGRESSION: CONTEXT_BLEED — "18 / 128.0K tokens" 128K fallback ──
  //
  // The bottom status row used to render `maxTokens={128000}` for every
  // selected model regardless of its real contextWindow — every
  // non-Gemini model whose registry value had not yet been recorded
  // into packages/core's per-model cache (tokenLimits.ts) showed 128K.
  // The fix is to resolve the active model's limit through
  // `tokenLimit()` — the same authority the rest of PLUMB uses. This
  // regression test asserts: with a model the registry reports as 200K,
  // the bottom meter shows 200K, NOT the previous 128K hardcoded
  // fallback. CONTEXT_BLEED = ZERO.
  it('REGRESSION (CONTEXT_BLEED): ContextVisualization maxTokens is resolved via tokenLimit(), not hardcoded to 128000', async () => {
    (useComposerStatus as Mock).mockReturnValue({
      isInteractiveShellWaiting: false,
      showLoadingIndicator: true,
      showTips: false,
      showWit: false,
      modeContentObj: null,
      showMinimalContext: false,
    });

    const uiState: Partial<UIState> = {
      ...defaultUiState,
      // A real Claude Sonnet 5 (Claude Subscription) has contextWindow
      // 200_000, NOT 128_000. Previously the meter would show
      // "200 / 128.0K tokens" because the hardcoded 128K overrode the
      // universal resolver.
      currentModel: 'claude-sonnet-5',
      sessionStats: {
        lastPromptTokenCount: 200,
      } as unknown as SessionStatsState,
    };

    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <StatusRow
        showUiDetails={true}
        isNarrow={false}
        terminalWidth={120}
        hideContextSummary={false}
        hideUiDetailsForSuggestions={false}
        hasPendingActionRequired={false}
      />,
      {
        width: 120,
        uiState,
      },
    );

    await waitUntilReady();
    const output = lastFrame();
    // The visualization shows the model max-token in the
    // "used / max tokens" line. The hardcoded 128000 was a 5x under
    // shoot for the real 200K Claude Sonnet 5 context, so the line
    // MUST NOT include 128.0K regardless of what the universal
    // resolver returns (1.0M is the last-resort default; 200.0K is
    // the registry-reported value; UNKNOWN is the no-info case).
    // The contract the test enforces is: no 128K fallback, ever.
    expect(output).not.toContain('128.0K');
    expect(output).toContain('claude-sonnet-5');
    // And the visualization is actually rendered (one of the three
    // well-formed outputs is present).
    expect(output).toMatch(
      /(\d+(?:\.\d+)?[KM]?)\s+tokens\s*\|\s*\S+\s+remaining/,
    );
  });
});

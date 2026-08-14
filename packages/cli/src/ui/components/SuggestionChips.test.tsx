/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { SubagentState } from '@plumb/core';
import { SuggestionChips } from './SuggestionChips.js';
import type { SessionEdit } from '../utils/sessionEditHistory.js';
import type { AgentRun } from '../utils/sessionAgentActivity.js';

function makeEdit(overrides: Partial<SessionEdit> = {}): SessionEdit {
  return {
    key: 'call-1',
    fileName: 'a.ts',
    filePath: '/repo/a.ts',
    fileDiff: 'diff',
    isNewFile: false,
    addedLines: 1,
    removedLines: 0,
    ...overrides,
  };
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    key: 'run-1',
    agentName: 'researcher',
    state: SubagentState.COMPLETED,
    activity: [],
    ...overrides,
  };
}

describe('SuggestionChips', () => {
  it('renders nothing when there is nothing to suggest', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <SuggestionChips edits={[]} agentRuns={[]} />,
    );
    expect(lastFrame({ allowEmpty: true })).toBe('');
    unmount();
  });

  it('suggests reviewing file edits, with correct singular/plural wording', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <SuggestionChips edits={[makeEdit()]} agentRuns={[]} />,
    );
    expect(lastFrame()).toContain('1 file changed — alt+r to review');
    unmount();
  });

  it('pluralizes multiple files', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <SuggestionChips
        edits={[makeEdit({ key: 'a' }), makeEdit({ key: 'b' })]}
        agentRuns={[]}
      />,
    );
    expect(lastFrame()).toContain('2 files changed — alt+r to review');
    unmount();
  });

  it('suggests agent mission control when agents ran', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <SuggestionChips edits={[]} agentRuns={[makeRun()]} />,
    );
    expect(lastFrame()).toContain('1 agent ran — alt+a for mission control');
    unmount();
  });

  it('shows both suggestions together, separated by a divider', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <SuggestionChips edits={[makeEdit()]} agentRuns={[makeRun()]} />,
    );
    const frame = lastFrame();
    expect(frame).toContain('file changed');
    expect(frame).toContain('agent ran');
    expect(frame).toContain('·');
    unmount();
  });
});

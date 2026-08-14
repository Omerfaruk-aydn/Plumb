/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { PlumbMessage } from './PlumbMessage.js';
import { StreamingState } from '../../types.js';
import { renderWithProviders } from '../../../test-utils/render.js';
import { describe, it, expect, vi } from 'vitest';

// GradientStreamCursor (F3) drives a real setInterval via useColorCycle,
// the same reason PlumbSpinner is always mocked wherever it's rendered
// directly and unmocked -- see GradientStreamCursor.tsx's own doc comment.
vi.mock('../GradientStreamCursor.js', () => ({
  GradientStreamCursor: () => null,
}));

describe('<PlumbMessage /> - Raw Markdown Display Snapshots', () => {
  const baseProps = {
    text: 'Test **bold** and `code` markdown\n\n```javascript\nconst x = 1;\n```',
    isPending: false,
    terminalWidth: 80,
  };

  it.each([
    { renderMarkdown: true, description: '(default)' },
    {
      renderMarkdown: false,
      description: '(raw markdown with syntax highlighting, no line numbers)',
    },
  ])(
    'renders with renderMarkdown=$renderMarkdown $description',
    async ({ renderMarkdown }) => {
      const { lastFrame, unmount } = await renderWithProviders(
        <PlumbMessage {...baseProps} />,
        {
          uiState: { renderMarkdown, streamingState: StreamingState.Idle },
        },
      );
      expect(lastFrame()).toMatchSnapshot();
      unmount();
    },
  );

  it.each([{ renderMarkdown: true }, { renderMarkdown: false }])(
    'renders pending state with renderMarkdown=$renderMarkdown',
    async ({ renderMarkdown }) => {
      const { lastFrame, unmount } = await renderWithProviders(
        <PlumbMessage {...baseProps} isPending={true} />,
        {
          uiState: { renderMarkdown, streamingState: StreamingState.Idle },
        },
      );
      expect(lastFrame()).toMatchSnapshot();
      unmount();
    },
  );

  it('wraps long lines correctly in raw markdown mode', async () => {
    const terminalWidth = 20;
    const text =
      'This is a long line that should wrap correctly without truncation';
    const { lastFrame, unmount } = await renderWithProviders(
      <PlumbMessage
        text={text}
        isPending={false}
        terminalWidth={terminalWidth}
      />,
      {
        uiState: { renderMarkdown: false, streamingState: StreamingState.Idle },
      },
    );
    expect(lastFrame()).toMatchSnapshot();
    unmount();
  });
});

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../../test-utils/render.js';
import { PillStrip } from './PillStrip.js';
import type { Pill } from './pillLayout.js';

const todo: Pill = {
  id: 'todo',
  tag: 'TODO',
  value: '2/5',
  detail: 'wire up the token refresh',
  marks: 0,
};

const queue: Pill = {
  id: 'queue',
  tag: 'QUEUE',
  value: '3',
  detail: 'and check the changelog',
  marks: 3,
};

describe('PillStrip', () => {
  it('renders the tag, value and detail of each pill', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <PillStrip pills={[todo, queue]} availableWidth={120} />,
      { width: 120 },
    );

    const frame = lastFrame();
    expect(frame).toContain('TODO');
    expect(frame).toContain('2/5');
    expect(frame).toContain('wire up the token refresh');
    expect(frame).toContain('QUEUE');
    unmount();
  });

  it('draws one progress mark per queued message', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <PillStrip pills={[queue]} availableWidth={120} />,
      { width: 120 },
    );

    expect(lastFrame().match(/▶/g)).toHaveLength(3);
    unmount();
  });

  it('caps the marks so a long queue cannot run off the row', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <PillStrip
        pills={[{ ...queue, value: '42', marks: 42, detail: undefined }]}
        availableWidth={120}
      />,
      { width: 120 },
    );

    const frame = lastFrame();
    expect(frame.match(/▶/g)).toHaveLength(9);
    // The count still tells the truth even though the glyphs stopped at nine.
    expect(frame).toContain('42');
    unmount();
  });

  it('renders nothing when there are no pills', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <PillStrip pills={[]} availableWidth={120} />,
      { width: 120 },
    );

    expect(lastFrame({ allowEmpty: true }).trim()).toBe('');
    unmount();
  });

  it('renders nothing when the row is too narrow for even one pill', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <PillStrip pills={[todo, queue]} availableWidth={6} />,
      { width: 6 },
    );

    expect(lastFrame({ allowEmpty: true }).trim()).toBe('');
    unmount();
  });

  it('stays one row tall when the details are long', async () => {
    const long = 'a task description that would wrap several times over'.repeat(
      3,
    );
    const { lastFrame, unmount } = await renderWithProviders(
      <PillStrip pills={[{ ...todo, detail: long }]} availableWidth={40} />,
      { width: 40 },
    );

    expect(lastFrame().trimEnd().split('\n')).toHaveLength(1);
    unmount();
  });
});

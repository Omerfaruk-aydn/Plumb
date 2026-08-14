/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import type { Config } from '@plumb/core';
import { renderWithProviders } from '../../../test-utils/render.js';
import { waitFor } from '../../../test-utils/async.js';
import { MemoryBrowser } from './MemoryBrowser.js';
import type { MemoryRecord } from '../../utils/memoryRecords.js';

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return { ...actual, useIsScreenReaderEnabled: vi.fn(() => false) };
});

const listMemoryRecordsMock = vi.fn();
const deleteMemoryRecordMock = vi.fn();
const exportMemoryRecordMock = vi.fn();

vi.mock('../../utils/memoryRecords.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../utils/memoryRecords.js')>();
  return {
    ...actual,
    listMemoryRecords: (...args: unknown[]) => listMemoryRecordsMock(...args),
    deleteMemoryRecord: (...args: unknown[]) => deleteMemoryRecordMock(...args),
    exportMemoryRecord: (...args: unknown[]) => exportMemoryRecordMock(...args),
  };
});

const RECORDS: MemoryRecord[] = [
  {
    id: 'skill:triage-bugs',
    kind: 'skill',
    label: 'Triage Bugs',
    summary: 'How to triage incoming bugs',
    date: new Date('2026-01-01T00:00:00.000Z'),
    content: '# Triage Bugs\nStep one...',
  },
  {
    id: 'patch:update-docs.patch',
    kind: 'patch',
    label: 'update-docs',
    summary: '1 file changed',
    date: new Date('2026-02-01T00:00:00.000Z'),
    content: '--- a\n+++ b\n',
  },
];

async function renderReady(config: Config, onClose = vi.fn()) {
  const instance = await act(async () =>
    renderWithProviders(<MemoryBrowser config={config} onClose={onClose} />),
  );
  await waitFor(() => {
    expect(instance.lastFrame()).not.toContain('Loading memory records');
  });
  return { ...instance, onClose };
}

/** Writes each character as its own event -- matches how a real terminal delivers keystrokes. */
async function typeKeys(
  stdin: { write: (data: string) => void },
  waitUntilReady: () => Promise<void>,
  ...keys: string[]
) {
  for (const key of keys) {
    await act(async () => {
      stdin.write(key);
      await waitUntilReady();
    });
  }
}

describe('MemoryBrowser', () => {
  const mockConfig = {} as Config;

  beforeEach(() => {
    listMemoryRecordsMock.mockReset().mockResolvedValue([...RECORDS]);
    deleteMemoryRecordMock
      .mockReset()
      .mockResolvedValue({ success: true, message: 'Dismissed.' });
    exportMemoryRecordMock
      .mockReset()
      .mockResolvedValue('/tmp/memory-export-triage-bugs.md');
  });

  it('lists records with kind/date and shows the selected record content', async () => {
    const { lastFrame } = await renderReady(mockConfig);

    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Triage Bugs');
      expect(frame).toContain('Step one');
    });
  });

  it('shows an empty-state card when there are no records', async () => {
    listMemoryRecordsMock.mockResolvedValue([]);
    const { lastFrame } = await renderReady(mockConfig);

    expect(lastFrame()).toContain('No memory records yet.');
  });

  it('filters the list via "/" and narrows to matching records', async () => {
    const { lastFrame, stdin, waitUntilReady } = await renderReady(mockConfig);

    await typeKeys(stdin, waitUntilReady, '/', 'd', 'o', 'c', 's');

    await waitFor(() => {
      expect(lastFrame()).not.toContain('Triage Bugs');
    });
    await waitFor(() => {
      expect(lastFrame()).toContain('update-doc');
    });
  });

  it('asks for confirmation on "d" and deletes only after "y"', async () => {
    const { lastFrame, stdin, waitUntilReady } = await renderReady(mockConfig);

    await typeKeys(stdin, waitUntilReady, 'd');
    await waitFor(() => {
      expect(lastFrame()).toContain('Delete this record?');
    });
    expect(deleteMemoryRecordMock).not.toHaveBeenCalled();

    await typeKeys(stdin, waitUntilReady, 'y');
    await waitFor(() => {
      expect(deleteMemoryRecordMock).toHaveBeenCalledTimes(1);
    });
  });

  it('cancels the pending delete on any key other than "y"', async () => {
    const { lastFrame, stdin, waitUntilReady } = await renderReady(mockConfig);

    await typeKeys(stdin, waitUntilReady, 'd');
    await waitFor(() => {
      expect(lastFrame()).toContain('Delete this record?');
    });

    await typeKeys(stdin, waitUntilReady, 'n');
    await waitFor(() => {
      expect(lastFrame()).toContain('Delete cancelled.');
    });
    expect(deleteMemoryRecordMock).not.toHaveBeenCalled();
  });

  it('exports the selected record on "e"', async () => {
    const { lastFrame, stdin, waitUntilReady } = await renderReady(mockConfig);

    await typeKeys(stdin, waitUntilReady, 'e');

    await waitFor(() => {
      expect(exportMemoryRecordMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(lastFrame()).toContain('Exported to');
    });
  });

  it('renders a flat text summary for a screen reader', async () => {
    const { useIsScreenReaderEnabled } = await import('ink');
    vi.mocked(useIsScreenReaderEnabled).mockReturnValue(true);

    const { lastFrame } = await renderReady(mockConfig);
    await waitFor(() => {
      expect(lastFrame()).toContain('skill: Triage Bugs');
    });

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Memory browser');

    vi.mocked(useIsScreenReaderEnabled).mockReturnValue(false);
  });

  it('closes on "q"', async () => {
    const { stdin, waitUntilReady, onClose } = await renderReady(mockConfig);

    await typeKeys(stdin, waitUntilReady, 'q');
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});

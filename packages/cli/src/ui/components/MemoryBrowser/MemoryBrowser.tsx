/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F23 (PLUMB-UI-DEVRIM-PROMPT.md): full-screen `/memory browse` -- lists,
 * filters, reads, deletes, and exports real extraction-inbox records via
 * `../../utils/memoryRecords.js` (which itself wraps the same core
 * list/dismiss functions `/memory inbox` (InboxDialog) uses).
 */
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useIsScreenReaderEnabled } from 'ink';
import { theme } from '../../semantic-colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { formatTimeAgo } from '../../utils/formatters.js';
import type { Config } from '@plumb/core';
import {
  listMemoryRecords,
  deleteMemoryRecord,
  exportMemoryRecord,
  filterMemoryRecords,
  paginateMemoryRecords,
  MEMORY_BROWSER_PAGE_SIZE,
  type MemoryRecord,
} from '../../utils/memoryRecords.js';

export interface MemoryBrowserProps {
  config: Config;
  onClose: () => void;
  /** Test seam: directory export writes land in. Defaults to process.cwd(). */
  exportTargetDir?: string;
}

const LIST_WIDTH = 32;

function kindLabel(kind: MemoryRecord['kind']): string {
  switch (kind) {
    case 'skill':
      return 'skill';
    case 'patch':
      return 'skill-patch';
    case 'memory-patch':
      return 'memory-patch';
    default:
      return kind;
  }
}

export const MemoryBrowser: React.FC<MemoryBrowserProps> = ({
  config,
  onClose,
  exportTargetDir,
}) => {
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  const { rows: terminalHeight } = useTerminalSize();

  const [records, setRecords] = useState<MemoryRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [filterActive, setFilterActive] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const reload = () => {
    listMemoryRecords(config)
      .then((r) => {
        setRecords(r);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        setRecords([]);
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Failed to load memory records.',
        );
      });
  };

  useEffect(reload, [config]);

  const filtered = useMemo(
    () => filterMemoryRecords(records ?? [], filterQuery),
    [records, filterQuery],
  );

  const { pageRecords, pageCount, clampedPage } = useMemo(
    () => paginateMemoryRecords(filtered, page, MEMORY_BROWSER_PAGE_SIZE),
    [filtered, page],
  );

  const clampedIndex = Math.min(
    selectedIndex,
    Math.max(0, pageRecords.length - 1),
  );
  const selected = pageRecords[clampedIndex];

  useKeypress(
    (key) => {
      if (filterActive) {
        if (key.name === 'escape' || key.name === 'return') {
          setFilterActive(false);
          return true;
        }
        if (key.name === 'backspace' || key.name === 'delete') {
          setFilterQuery((q) => q.slice(0, -1));
          return true;
        }
        if (key.sequence && !key.ctrl && !key.alt) {
          setFilterQuery((q) => q + key.sequence);
          setPage(0);
          setSelectedIndex(0);
        }
        return true;
      }

      if (pendingDeleteId !== null) {
        if (key.sequence === 'y' && !key.ctrl) {
          const target = (records ?? []).find((r) => r.id === pendingDeleteId);
          setPendingDeleteId(null);
          if (target) {
            void deleteMemoryRecord(config, target).then((result) => {
              setStatusMessage(result.message);
              reload();
            });
          }
        } else {
          setPendingDeleteId(null);
          setStatusMessage('Delete cancelled.');
        }
        return true;
      }

      if (key.name === 'escape' || (key.sequence === 'q' && !key.ctrl)) {
        onClose();
        return true;
      }
      if (key.name === 'up' || key.name === 'k') {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return true;
      }
      if (key.name === 'down' || key.name === 'j') {
        setSelectedIndex((i) => Math.min(pageRecords.length - 1, i + 1));
        return true;
      }
      if (key.name === 'left' || key.sequence === '[') {
        setPage((p) => Math.max(0, p - 1));
        setSelectedIndex(0);
        return true;
      }
      if (key.name === 'right' || key.sequence === ']') {
        setPage((p) => Math.min(pageCount - 1, p + 1));
        setSelectedIndex(0);
        return true;
      }
      if (key.sequence === '/' && !key.ctrl) {
        setFilterActive(true);
        setStatusMessage(null);
        return true;
      }
      if (key.sequence === 'd' && !key.ctrl && selected) {
        setPendingDeleteId(selected.id);
        return true;
      }
      if (key.sequence === 'e' && !key.ctrl && selected) {
        void exportMemoryRecord(
          selected,
          exportTargetDir ?? process.cwd(),
        ).then((filePath) => setStatusMessage(`Exported to ${filePath}`));
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  if (isScreenReaderEnabled) {
    return (
      <Box flexDirection="column">
        <Text>
          Memory browser. {filtered.length} record
          {filtered.length === 1 ? '' : 's'}
          {filterQuery ? ` matching "${filterQuery}"` : ''}.
        </Text>
        {filtered.length === 0 ? (
          <Text>No memory records found.</Text>
        ) : (
          filtered.map((r) => (
            <Text key={r.id}>
              {kindLabel(r.kind)}: {r.label} — {r.summary}
            </Text>
          ))
        )}
      </Box>
    );
  }

  if (records === null) {
    return (
      <Box paddingX={1}>
        <Text dimColor>Loading memory records…</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={terminalHeight} paddingX={1}>
      <Text color={theme.text.accent} bold>
        Memory Browser
      </Text>
      {loadError && <Text color={theme.status.error}>{loadError}</Text>}

      <Box marginTop={1}>
        <Text dimColor>
          {filterActive
            ? `/${filterQuery}`
            : filterQuery
              ? `filter: ${filterQuery}`
              : '/ to filter'}
        </Text>
      </Box>

      {records.length === 0 ? (
        <Box marginTop={1}>
          <Text dimColor>No memory records yet.</Text>
        </Box>
      ) : filtered.length === 0 ? (
        <Box marginTop={1}>
          <Text dimColor>No records match &quot;{filterQuery}&quot;.</Text>
        </Box>
      ) : (
        <Box flexDirection="row" marginTop={1}>
          <Box flexDirection="column" width={LIST_WIDTH} flexShrink={0}>
            {pageRecords.map((r, i) => {
              const isSelected = i === clampedIndex;
              return (
                <Box key={r.id}>
                  <Text
                    color={isSelected ? theme.text.accent : undefined}
                    bold={isSelected}
                  >
                    {isSelected ? '❯ ' : '  '}[{kindLabel(r.kind)}]{' '}
                    {r.date ? formatTimeAgo(r.date) : 'unknown time'}
                  </Text>
                  <Text dimColor={!isSelected}> {r.label}</Text>
                </Box>
              );
            })}
            {pageCount > 1 && (
              <Box marginTop={1}>
                <Text dimColor>
                  page {clampedPage + 1}/{pageCount}
                </Text>
              </Box>
            )}
          </Box>

          <Box flexDirection="column" flexGrow={1} paddingLeft={2}>
            {selected ? (
              <>
                <Text bold>{selected.label}</Text>
                <Text dimColor>{selected.summary}</Text>
                <Box marginTop={1} flexDirection="column">
                  <Text>{selected.content || '(empty)'}</Text>
                </Box>
              </>
            ) : (
              <Text dimColor>No record selected.</Text>
            )}
          </Box>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        {pendingDeleteId !== null && (
          <Text color={theme.status.warning}>
            Delete this record? y to confirm, any other key to cancel.
          </Text>
        )}
        {statusMessage && <Text dimColor>{statusMessage}</Text>}
        <Text dimColor>
          ↑/↓ select · ←/→ page · / filter · d delete · e export · q/Esc close
        </Text>
      </Box>
    </Box>
  );
};

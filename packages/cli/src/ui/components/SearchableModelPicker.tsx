/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useMemo, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useKeypress } from '../hooks/useKeypress.js';
import type { PlumbModel } from '@google/gemini-cli-provider';

export interface SearchableModelPickerProps {
  models: PlumbModel[];
  onSelect: (model: PlumbModel) => void;
  onCancel: () => void;
  onRefresh?: () => void;
  initialQuery?: string;
  /** Pre-highlight (not auto-select) this model id if present in `models`. */
  initialSelectedId?: string;
}

const MAX_VISIBLE_ROWS = 15;

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;

  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function getCapabilityBadges(model: PlumbModel): string[] {
  const badges: string[] = [];
  if (model.reasoning) badges.push('reasoning');
  if (model.input === 'text+image') badges.push('vision');
  if (model.input === 'text+image+audio') badges.push('multimodal');
  if (model.isPreview) badges.push('preview');
  return badges;
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

export const SearchableModelPicker: React.FC<SearchableModelPickerProps> = ({
  models,
  onSelect,
  onCancel,
  onRefresh,
  initialQuery = '',
  initialSelectedId,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const initialIndex = Math.max(
    0,
    initialSelectedId ? models.findIndex((m) => m.id === initialSelectedId) : 0,
  );
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [scrollOffset, setScrollOffset] = useState(() =>
    initialIndex >= MAX_VISIBLE_ROWS ? initialIndex - MAX_VISIBLE_ROWS + 1 : 0,
  );

  const filteredModels = useMemo(() => {
    if (!query.trim()) return models;
    return models.filter(
      (m) =>
        fuzzyMatch(query, m.id) ||
        fuzzyMatch(query, m.name ?? '') ||
        fuzzyMatch(query, m.provider),
    );
  }, [models, query]);

  const visibleModels = useMemo(
    () => filteredModels.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ROWS),
    [filteredModels, scrollOffset],
  );

  const handleSelect = useCallback(() => {
    const model = filteredModels[selectedIndex];
    if (model) onSelect(model);
  }, [filteredModels, selectedIndex, onSelect]);

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (query.length > 0) {
          setQuery('');
          setSelectedIndex(0);
          setScrollOffset(0);
        } else {
          onCancel();
        }
        return true;
      }

      if (key.name === 'enter') {
        handleSelect();
        return true;
      }

      if (key.name === 'up') {
        setSelectedIndex((i) => {
          const next = Math.max(0, i - 1);
          if (next < scrollOffset) setScrollOffset(next);
          return next;
        });
        return true;
      }

      if (key.name === 'down') {
        setSelectedIndex((i) => {
          const next = Math.min(filteredModels.length - 1, i + 1);
          if (next >= scrollOffset + MAX_VISIBLE_ROWS) {
            setScrollOffset(next - MAX_VISIBLE_ROWS + 1);
          }
          return next;
        });
        return true;
      }

      if (key.name === 'backspace') {
        setQuery((prev) => prev.slice(0, -1));
        setSelectedIndex(0);
        setScrollOffset(0);
        return true;
      }

      if (key.insertable && key.sequence && !key.ctrl && !key.alt && !key.cmd) {
        setQuery((prev) => prev + key.sequence);
        setSelectedIndex(0);
        setScrollOffset(0);
        return true;
      }

      return false;
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column">
      <Text bold>
        Search models ({filteredModels.length} / {models.length}):
      </Text>
      <Box marginY={0}>
        <Text>
          {query}
          <Text dimColor>▌</Text>
        </Text>
      </Box>

      {filteredModels.length === 0 ? (
        <Box marginY={1}>
          <Text dimColor>No models match &quot;{query}&quot;</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginY={0}>
          {scrollOffset > 0 && <Text dimColor> ▲ {scrollOffset} more</Text>}
          {visibleModels.map((model, i) => {
            const globalIndex = scrollOffset + i;
            const isSelected = globalIndex === selectedIndex;
            const badges = getCapabilityBadges(model);
            const ctxStr = formatContextWindow(model.contextWindow);

            return (
              <Box key={`${model.provider}:${model.id}`}>
                <Text color={isSelected ? 'cyan' : undefined}>
                  {isSelected ? '▶ ' : '  '}
                  {model.name ?? model.id}
                </Text>
                <Text dimColor>
                  {' '}
                  [{model.provider}] {ctxStr}
                  {badges.length > 0 ? ` ${badges.join(' ')}` : ''}
                </Text>
              </Box>
            );
          })}
          {scrollOffset + MAX_VISIBLE_ROWS < filteredModels.length && (
            <Text dimColor>
              {' '}
              ▼ {filteredModels.length - scrollOffset - MAX_VISIBLE_ROWS} more
            </Text>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          Type to search • ↑↓ navigate • Enter select • ESC
          {query ? ' clear' : ' back'}
          {onRefresh ? ' • Ctrl+R refresh' : ''}
        </Text>
      </Box>
    </Box>
  );
};

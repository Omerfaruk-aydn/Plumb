/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useMemo, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useKeypress } from '../hooks/useKeypress.js';
import type { PlumbModel } from '@plumb/provider';
import { theme } from '../semantic-colors.js';
import { benchmarkKey, type BenchmarkEntry } from '../../bench/storage.js';
import { formatBenchmarkBadge } from '../utils/benchmarkBadge.js';

export interface SearchableModelPickerProps {
  models: PlumbModel[];
  onSelect: (model: PlumbModel) => void;
  onCancel: () => void;
  onRefresh?: () => void;
  initialQuery?: string;
  /** Pre-highlight (not auto-select) this model id if present in `models`. */
  initialSelectedId?: string;
  /** F26: real /bench results, keyed by `benchmarkKey(provider, modelId)`. Omit/empty when none exist yet. */
  benchmarkEntries?: Record<string, BenchmarkEntry>;
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

/**
 * A model is displayed as FREE only when its pricing record is present AND
 * every field is exactly zero -- real reported zero cost (e.g. OpenCode
 * Zen's `-free`-suffixed models), never inferred from the id/name string
 * and never the default for a model with no pricing data at all (missing
 * pricing means unknown, not free).
 */
function isFreeModel(model: PlumbModel): boolean {
  const p = model.pricing;
  if (!p) return false;
  return (
    p.input === 0 &&
    p.output === 0 &&
    (p.cacheRead ?? 0) === 0 &&
    (p.cacheWrite ?? 0) === 0
  );
}

/**
 * Compact, honest tool-calling capability label for the model picker row.
 * Reads `model.toolsSupported` directly -- the same canonical field the
 * registry/inventory/prompt-and-wire gate (getEffectiveToolsAdvertisable)
 * already resolve, no second cache. `undefined` (UNKNOWN) is never
 * displayed as either "tools" or "no tools" -- it gets its own honest
 * "tools ?" label so the user isn't misled into thinking absence of
 * evidence is evidence of absence.
 */
function toolsCapabilityLabel(model: PlumbModel): string {
  if (model.toolsSupported === true) return 'tools';
  if (model.toolsSupported === false) return 'no tools';
  return 'tools ?';
}

function getCapabilityBadges(model: PlumbModel): string[] {
  const badges: string[] = [];
  if (isFreeModel(model)) badges.push('FREE');
  if (model.reasoning) badges.push('reasoning');
  badges.push(toolsCapabilityLabel(model));
  if (model.input === 'text+image') badges.push('vision');
  if (model.input === 'text+image+audio') badges.push('multimodal');
  if (model.isPreview) badges.push('preview');
  return badges;
}

function formatTokenCount(tokens: number): string {
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
  benchmarkEntries = {},
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
            // Each model reads its OWN contextWindow/maxTokens -- never a
            // provider-level or sibling-model constant. `0` from an
            // unresolved discovery floor means "unknown", never fabricated
            // as a specific limit.
            const ctxStr =
              model.contextWindow > 0
                ? `${formatTokenCount(model.contextWindow)} ctx`
                : 'ctx unknown';
            const outStr =
              model.maxTokens > 0
                ? `${formatTokenCount(model.maxTokens)} max output`
                : null;

            const benchmarkBadge = formatBenchmarkBadge(
              benchmarkEntries[benchmarkKey(model.provider, model.id)],
            );

            return (
              <Box key={`${model.provider}:${model.id}`}>
                <Text color={isSelected ? 'cyan' : undefined}>
                  {isSelected ? '▶ ' : '  '}
                  {model.name ?? model.id}
                </Text>
                <Text dimColor>
                  {' '}
                  [{model.provider}] {ctxStr}
                  {outStr ? ` · ${outStr}` : ''}
                  {badges.length > 0 ? ` ${badges.join(' ')}` : ''}
                </Text>
                {benchmarkBadge && (
                  <Text
                    dimColor={benchmarkBadge.stale}
                    color={
                      benchmarkBadge.stale ? undefined : theme.status.success
                    }
                  >
                    {' '}
                    · {benchmarkBadge.text}
                  </Text>
                )}
              </Box>
            );
          })}
          {scrollOffset + MAX_VISIBLE_ROWS < filteredModels.length && (
            <Text dimColor>
              {' '}
              ▼ {filteredModels.length - scrollOffset - MAX_VISIBLE_ROWS} more
            </Text>
          )}
          {filteredModels[selectedIndex] &&
            !formatBenchmarkBadge(
              benchmarkEntries[
                benchmarkKey(
                  filteredModels[selectedIndex].provider,
                  filteredModels[selectedIndex].id,
                )
              ],
            ) && (
              <Box marginTop={1}>
                <Text dimColor>
                  /bench to measure edit accuracy on this model
                </Text>
              </Box>
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

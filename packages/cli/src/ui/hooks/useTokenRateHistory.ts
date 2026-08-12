/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F5 (PLUMB-UI-DEVRIM-PROMPT.md) token-rate sparkline data source.
 * SessionContext's `lastPromptTokenCount` already updates reactively off
 * a real event (uiTelemetryService's 'update' event fires on actual
 * token usage changes, not a timer -- see SessionContext.tsx). This
 * hook just accumulates those real updates into a capped history array,
 * so it never owns a timer of its own either.
 */
import { useEffect, useRef, useState } from 'react';

const DEFAULT_MAX_SAMPLES = 20;

export function useTokenRateHistory(
  tokenCount: number,
  maxSamples: number = DEFAULT_MAX_SAMPLES,
): number[] {
  const [history, setHistory] = useState<number[]>([]);
  const lastSampledRef = useRef<number | null>(null);

  useEffect(() => {
    if (lastSampledRef.current === tokenCount) return;
    lastSampledRef.current = tokenCount;
    setHistory((prev) => {
      const next = [...prev, tokenCount];
      return next.length > maxSamples
        ? next.slice(next.length - maxSamples)
        : next;
    });
  }, [tokenCount, maxSamples]);

  return history;
}

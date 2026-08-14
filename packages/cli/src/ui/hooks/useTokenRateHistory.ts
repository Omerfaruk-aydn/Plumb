/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
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

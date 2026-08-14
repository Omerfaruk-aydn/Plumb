/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';

export interface UseDiffReviewCommandReturn {
  isDiffReviewOpen: boolean;
  openDiffReview: () => void;
  closeDiffReview: () => void;
}

/** Open/close state for the diff review screen (F7). Read-only, nothing to
 * revert on close -- see DiffReviewScreen.tsx for the scoping rationale. */
export const useDiffReviewCommand = (): UseDiffReviewCommandReturn => {
  const [isDiffReviewOpen, setIsDiffReviewOpen] = useState(false);

  const openDiffReview = useCallback(() => setIsDiffReviewOpen(true), []);
  const closeDiffReview = useCallback(() => setIsDiffReviewOpen(false), []);

  return { isDiffReviewOpen, openDiffReview, closeDiffReview };
};

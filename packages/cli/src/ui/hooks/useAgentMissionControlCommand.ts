/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';

export interface UseAgentMissionControlCommandReturn {
  isAgentMissionControlOpen: boolean;
  openAgentMissionControl: () => void;
  closeAgentMissionControl: () => void;
}

/** Open/close state for the agent mission control screen (F8). Read-only,
 * nothing to revert on close -- see AgentMissionControl.tsx for the
 * scoping rationale. */
export const useAgentMissionControlCommand =
  (): UseAgentMissionControlCommandReturn => {
    const [isAgentMissionControlOpen, setIsAgentMissionControlOpen] =
      useState(false);

    const openAgentMissionControl = useCallback(
      () => setIsAgentMissionControlOpen(true),
      [],
    );
    const closeAgentMissionControl = useCallback(
      () => setIsAgentMissionControlOpen(false),
      [],
    );

    return {
      isAgentMissionControlOpen,
      openAgentMissionControl,
      closeAgentMissionControl,
    };
  };

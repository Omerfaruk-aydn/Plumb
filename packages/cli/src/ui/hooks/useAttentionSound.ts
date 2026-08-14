/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F18 (PLUMB-UI-DEVRIM-PROMPT.md): plays a short attention sound on
 * question / tool-permission / error / response-done / subagent-done
 * events. Unlike `useRunEventNotifications` (OSC 9 desktop notifications,
 * blur-only), sound plays whether or not the terminal is focused -- only
 * the desktop notification is focus-gated.
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  StreamingState,
  type ConfirmationRequest,
  type HistoryItem,
  type HistoryItemWithoutId,
  type PermissionConfirmationRequest,
} from '../types.js';
import { getPendingAttentionNotification } from '../utils/pendingAttentionNotification.js';
import {
  getAttentionSettings,
  playAttentionSound,
  type AttentionEventType,
} from '../utils/attention.js';
import type { LoadedSettings } from '../../config/settings.js';

interface UseAttentionSoundParams {
  settings: LoadedSettings;
  streamingState: StreamingState;
  hasPendingActionRequired: boolean;
  pendingHistoryItems: HistoryItemWithoutId[];
  history: HistoryItem[];
  commandConfirmationRequest: ConfirmationRequest | null;
  authConsentRequest: ConfirmationRequest | null;
  permissionConfirmationRequest: PermissionConfirmationRequest | null;
  hasConfirmUpdateExtensionRequests: boolean;
  hasLoopDetectionConfirmationRequest: boolean;
}

function eventTypeForAttentionKey(key: string): AttentionEventType {
  return key.startsWith('ask_user:') ? 'question' : 'permission';
}

export function useAttentionSound({
  settings,
  streamingState,
  hasPendingActionRequired,
  pendingHistoryItems,
  history,
  commandConfirmationRequest,
  authConsentRequest,
  permissionConfirmationRequest,
  hasConfirmUpdateExtensionRequests,
  hasLoopDetectionConfirmationRequest,
}: UseAttentionSoundParams): void {
  const attentionSettings = useMemo(
    () => getAttentionSettings(settings),
    [settings],
  );

  const pendingAttentionNotification = useMemo(
    () =>
      getPendingAttentionNotification(
        pendingHistoryItems,
        commandConfirmationRequest,
        authConsentRequest,
        permissionConfirmationRequest,
        hasConfirmUpdateExtensionRequests,
        hasLoopDetectionConfirmationRequest,
      ),
    [
      pendingHistoryItems,
      commandConfirmationRequest,
      authConsentRequest,
      permissionConfirmationRequest,
      hasConfirmUpdateExtensionRequests,
      hasLoopDetectionConfirmationRequest,
    ],
  );

  const lastAttentionKeyRef = useRef<string | null>(null);
  const previousStreamingStateRef = useRef(streamingState);
  const previousErrorCountRef = useRef<number | null>(null);
  const previousSubagentCountRef = useRef<number | null>(null);

  // Question / permission sounds: play once per newly-seen pending item.
  useEffect(() => {
    if (!attentionSettings.enabled) return;

    const currentKey = pendingAttentionNotification?.key ?? null;
    const previousKey = lastAttentionKeyRef.current;
    lastAttentionKeyRef.current = currentKey;

    if (!currentKey || currentKey === previousKey) return;

    playAttentionSound(attentionSettings, eventTypeForAttentionKey(currentKey));
  }, [attentionSettings, pendingAttentionNotification]);

  // Done sound: play when a response turn completes without requiring
  // further action from the user.
  useEffect(() => {
    if (!attentionSettings.enabled) return;

    const previousStreamingState = previousStreamingStateRef.current;
    previousStreamingStateRef.current = streamingState;

    const justCompletedTurn =
      previousStreamingState === StreamingState.Responding &&
      streamingState === StreamingState.Idle;

    if (!justCompletedTurn || hasPendingActionRequired) return;

    playAttentionSound(attentionSettings, 'done');
  }, [attentionSettings, streamingState, hasPendingActionRequired]);

  // Error / subagent-done sounds: derived from new items landing in history.
  useEffect(() => {
    if (!attentionSettings.enabled) return;

    let errorCount = 0;
    let subagentCount = 0;
    for (const item of history) {
      if (item.type === 'error') errorCount++;
      else if (item.type === 'subagent') subagentCount++;
    }

    const previousErrorCount = previousErrorCountRef.current;
    const previousSubagentCount = previousSubagentCountRef.current;
    previousErrorCountRef.current = errorCount;
    previousSubagentCountRef.current = subagentCount;

    if (previousErrorCount !== null && errorCount > previousErrorCount) {
      playAttentionSound(attentionSettings, 'error');
      return;
    }
    if (
      previousSubagentCount !== null &&
      subagentCount > previousSubagentCount
    ) {
      playAttentionSound(attentionSettings, 'subagent_done');
    }
  }, [attentionSettings, history]);
}

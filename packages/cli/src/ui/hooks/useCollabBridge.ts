/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F21 (PLUMB-UI-DEVRIM-PROMPT.md): bridges UIState (chat history) into the
 * running CollabServer, if any. A no-op while `/collab` hasn't been started.
 * On start, only messages from that point forward are streamed -- it does
 * not backfill everything said before the session went live.
 */
import { useEffect, useRef } from 'react';
import type { HistoryItem } from '../types.js';
import { getCollabServer, type CollabRole } from '../../collab/collabServer.js';

function roleForHistoryItem(item: HistoryItem): CollabRole | null {
  switch (item.type) {
    case 'user':
      return 'user';
    case 'gemini':
    case 'gemini_content':
      return 'assistant';
    case 'info':
    case 'error':
    case 'warning':
      return 'system';
    default:
      return null;
  }
}

function textForHistoryItem(item: HistoryItem): string | null {
  if ('text' in item && typeof item.text === 'string' && item.text.trim()) {
    return item.text;
  }
  return null;
}

export function useCollabBridge(history: HistoryItem[]): void {
  const lastPushedIdRef = useRef(0);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    const server = getCollabServer();
    const running = server.isRunning();
    const lastHistoryId =
      history.length > 0 ? history[history.length - 1].id : 0;

    if (running && !wasRunningRef.current) {
      // Just went live: stream forward from here, don't dump prior history.
      lastPushedIdRef.current = lastHistoryId;
    }
    wasRunningRef.current = running;

    if (!running) return;

    if (lastHistoryId < lastPushedIdRef.current) {
      // History shrank (e.g. /clear) -- ids restart, so restart tracking too.
      lastPushedIdRef.current = 0;
    }

    for (const item of history) {
      if (item.id <= lastPushedIdRef.current) continue;
      lastPushedIdRef.current = item.id;

      const role = roleForHistoryItem(item);
      const text = textForHistoryItem(item);
      if (!role || !text) continue;

      server.pushMessage({ role, text, timestamp: Date.now() });
    }
  }, [history]);
}

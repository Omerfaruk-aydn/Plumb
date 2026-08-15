/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */
import { useEffect, useRef } from 'react';
import type { HistoryItem } from '../types.js';
import { getCollabServer, type CollabRole } from '../../collab/collabServer.js';

function roleForHistoryItem(item: HistoryItem): CollabRole | null {
  switch (item.type) {
    case 'user':
      return 'user';
    case 'plumb':
    case 'plumb_content':
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

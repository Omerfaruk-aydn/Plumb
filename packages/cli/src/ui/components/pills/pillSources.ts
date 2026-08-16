/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TodoList } from '@plumb/core';
import { flattenDetail, type Pill } from './pillLayout.js';

export interface PillSources {
  /** The most recent todo list a tool produced, or null when none exists. */
  readonly todos: TodoList | null;
  /** Messages typed while a turn was streaming, oldest first. */
  readonly messageQueue: readonly string[];
  /**
   * Whether the full todo checklist is already expanded on screen. The pill
   * would then be restating a heading the user is looking at.
   */
  readonly todosExpanded: boolean;
}

/**
 * Derives the pill row from current UI state.
 *
 * Order is fixed rather than by recency: a row whose contents jump position
 * between frames costs more to read than it saves, because the eye has to
 * re-find each pill instead of returning to where it was.
 */
export function buildPills(sources: PillSources): Pill[] {
  const pills: Pill[] = [];

  const todo = buildTodoPill(sources);
  if (todo) pills.push(todo);

  const queue = buildQueuePill(sources.messageQueue);
  if (queue) pills.push(queue);

  return pills;
}

function buildTodoPill(sources: PillSources): Pill | null {
  if (sources.todosExpanded) return null;

  const todos = sources.todos?.todos;
  if (!todos || todos.length === 0) return null;

  // Cancelled items are excluded from both halves of the ratio: counting them
  // in the denominator makes a finished list read as `4/5` forever, which
  // looks like something is stuck.
  const counted = todos.filter((item) => item.status !== 'cancelled');
  if (counted.length === 0) return null;

  const hasActive = counted.some(
    (item) => item.status === 'pending' || item.status === 'in_progress',
  );
  // A finished list is history, not work in flight. It stays in the
  // scrollback where the user can scroll back to it.
  if (!hasActive) return null;

  const completed = counted.filter(
    (item) => item.status === 'completed',
  ).length;

  // What the user wants from one line is "what is happening now" -- the
  // in-progress item. With none in progress, the next pending item answers
  // the follow-up question instead: what happens next.
  const current =
    counted.find((item) => item.status === 'in_progress') ??
    counted.find((item) => item.status === 'pending');

  return {
    id: 'todo',
    tag: 'TODO',
    value: `${completed}/${counted.length}`,
    detail: current ? flattenDetail(current.description) : undefined,
    marks: 0,
  };
}

function buildQueuePill(messageQueue: readonly string[]): Pill | null {
  if (messageQueue.length === 0) return null;

  return {
    id: 'queue',
    tag: 'QUEUE',
    value: String(messageQueue.length),
    // Only the message that will be sent next: the queue is FIFO, so the
    // first entry is the one whose wording the user might still want to fix.
    detail: flattenDetail(messageQueue[0]) || undefined,
    marks: messageQueue.length,
  };
}

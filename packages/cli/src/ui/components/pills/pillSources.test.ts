/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { TodoList } from '@plumb/core';
import { buildPills } from './pillSources.js';

function todoList(...todos: TodoList['todos']): TodoList {
  return { todos };
}

const noTodos = { todos: null, todosExpanded: false, messageQueue: [] };

describe('todo pill', () => {
  it('counts completed against the total', () => {
    const pills = buildPills({
      ...noTodos,
      todos: todoList(
        { description: 'one', status: 'completed' },
        { description: 'two', status: 'in_progress' },
        { description: 'three', status: 'pending' },
      ),
    });

    expect(pills[0]).toMatchObject({ id: 'todo', value: '1/3', detail: 'two' });
  });

  it('excludes cancelled items from both halves of the ratio', () => {
    const pills = buildPills({
      ...noTodos,
      todos: todoList(
        { description: 'one', status: 'completed' },
        { description: 'two', status: 'cancelled' },
        { description: 'three', status: 'pending' },
      ),
    });

    // Counting the cancelled item would strand this at 1/3 forever, which
    // reads as a stall rather than as a plan that changed.
    expect(pills[0]).toMatchObject({ value: '1/2' });
  });

  it('shows the next pending item when nothing is in progress', () => {
    const pills = buildPills({
      ...noTodos,
      todos: todoList(
        { description: 'done', status: 'completed' },
        { description: 'up next', status: 'pending' },
      ),
    });

    expect(pills[0]).toMatchObject({ detail: 'up next' });
  });

  it('stands down once every item is finished', () => {
    const pills = buildPills({
      ...noTodos,
      todos: todoList(
        { description: 'one', status: 'completed' },
        { description: 'two', status: 'completed' },
      ),
    });

    expect(pills).toEqual([]);
  });

  it('stands down while the full checklist is expanded', () => {
    const pills = buildPills({
      ...noTodos,
      todosExpanded: true,
      todos: todoList({ description: 'one', status: 'in_progress' }),
    });

    expect(pills).toEqual([]);
  });

  it('treats a blocked-only list as still in flight', () => {
    // Blocked work is not finished work: the user needs to see it is stuck.
    const pills = buildPills({
      ...noTodos,
      todos: todoList(
        { description: 'one', status: 'completed' },
        { description: 'two', status: 'blocked' },
      ),
    });

    expect(pills).toEqual([]);
  });

  it('renders nothing when no tool has written a list', () => {
    expect(buildPills(noTodos)).toEqual([]);
    expect(buildPills({ ...noTodos, todos: todoList() })).toEqual([]);
  });
});

describe('queue pill', () => {
  it('counts the queue and previews the message that goes next', () => {
    const pills = buildPills({
      ...noTodos,
      messageQueue: ['first\nmessage', 'second'],
    });

    expect(pills[0]).toMatchObject({
      id: 'queue',
      value: '2',
      marks: 2,
      detail: 'first message',
    });
  });

  it('renders nothing for an empty queue', () => {
    expect(buildPills({ ...noTodos, messageQueue: [] })).toEqual([]);
  });

  it('omits the detail for a whitespace-only message', () => {
    const pills = buildPills({ ...noTodos, messageQueue: ['   '] });
    expect(pills[0].detail).toBeUndefined();
  });
});

describe('ordering', () => {
  it('keeps todo ahead of queue so neither moves between frames', () => {
    const pills = buildPills({
      todos: todoList({ description: 'one', status: 'in_progress' }),
      todosExpanded: false,
      messageQueue: ['later'],
    });

    expect(pills.map((pill) => pill.id)).toEqual(['todo', 'queue']);
  });
});

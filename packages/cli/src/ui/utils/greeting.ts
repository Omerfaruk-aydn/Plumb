/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F6 (PLUMB-UI-DEVRIM-PROMPT.md), scoped: a time-of-day greeting for the
 * empty-history welcome moment. Pure function -- no clock/interval owned
 * here, the caller reads Date.now() once per render.
 */

export function getTimeBasedGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return 'Working late? Let’s build something.';
  if (hour < 12) return 'Good morning — what are we building?';
  if (hour < 18) return 'Good afternoon — what are we building?';
  return 'Good evening — what are we building?';
}

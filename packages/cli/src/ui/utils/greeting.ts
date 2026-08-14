/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export function getTimeBasedGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return 'Working late? Let’s build something.';
  if (hour < 12) return 'Good morning — what are we building?';
  if (hour < 18) return 'Good afternoon — what are we building?';
  return 'Good evening — what are we building?';
}

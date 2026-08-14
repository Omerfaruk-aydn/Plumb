/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F26 (PLUMB-UI-DEVRIM-PROMPT.md): the 5 small, deliberately unambiguous
 * edit tasks `/bench` runs against the current model. Each fixture is
 * self-contained (no repo context needed) so the benchmark measures pure
 * instruction-following on a small edit, not retrieval or tool use.
 */

export interface BenchmarkFixture {
  id: string;
  instruction: string;
  original: string;
  expected: string;
}

export const BENCHMARK_FIXTURES: readonly BenchmarkFixture[] = [
  {
    id: 'off-by-one',
    instruction:
      'Fix the off-by-one bug in this loop so it includes the last element. Reply with only the corrected code, no explanation.',
    original: `function sumArray(nums) {
  let total = 0;
  for (let i = 0; i < nums.length - 1; i++) {
    total += nums[i];
  }
  return total;
}`,
    expected: `function sumArray(nums) {
  let total = 0;
  for (let i = 0; i < nums.length; i++) {
    total += nums[i];
  }
  return total;
}`,
  },
  {
    id: 'rename-variable',
    instruction:
      'Rename the variable "cnt" to "count" everywhere in this snippet. Reply with only the corrected code, no explanation.',
    original: `function countEvens(nums) {
  let cnt = 0;
  for (const n of nums) {
    if (n % 2 === 0) cnt++;
  }
  return cnt;
}`,
    expected: `function countEvens(nums) {
  let count = 0;
  for (const n of nums) {
    if (n % 2 === 0) count++;
  }
  return count;
}`,
  },
  {
    id: 'null-check',
    instruction:
      'Add a null/undefined check for "user" before accessing user.name, returning "unknown" if user is missing. Reply with only the corrected code, no explanation.',
    original: `function greet(user) {
  return "Hello, " + user.name;
}`,
    expected: `function greet(user) {
  if (!user) return "unknown";
  return "Hello, " + user.name;
}`,
  },
  {
    id: 'fix-typo',
    instruction:
      'Fix the spelling typo "recieve" -> "receive" in this string. Reply with only the corrected code, no explanation.',
    original: `const message = "We recieve your request and will respond soon.";`,
    expected: `const message = "We receive your request and will respond soon.";`,
  },
  {
    id: 'add-export',
    instruction:
      'Add the "export" keyword so this function can be imported elsewhere. Reply with only the corrected code, no explanation.',
    original: `function formatPrice(cents) {
  return "$" + (cents / 100).toFixed(2);
}`,
    expected: `export function formatPrice(cents) {
  return "$" + (cents / 100).toFixed(2);
}`,
  },
];

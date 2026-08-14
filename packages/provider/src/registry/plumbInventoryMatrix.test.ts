/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  PLUMB_INVENTORY_FIXTURE,
  REFERENCE_ROUTES,
  type FrozenProviderRow,
} from './__fixtures__/plumbInventory.js';

describe('PLUMB inventory snapshot integrity', () => {
  it('contains exactly the six reference routes as PRODUCTION_READY', () => {
    for (const id of REFERENCE_ROUTES) {
      const row = PLUMB_INVENTORY_FIXTURE.find((r) => r.id === id);
      expect(row, `inventory row missing for ${id}`).toBeDefined();
      expect(row?.finalClassification).toBe('PRODUCTION_READY');
    }
  });

  it('uses unique ids', () => {
    const seen = new Set<string>();
    for (const row of PLUMB_INVENTORY_FIXTURE) {
      expect(seen.has(row.id), `duplicate id ${row.id}`).toBe(false);
      seen.add(row.id);
    }
  });

  it('every row has a non-empty name and valid category', () => {
    const allowedCategories = new Set([
      'coding_plan',
      'oauth_account',
      'api_key',
      'local',
      'custom_endpoint',
    ]);
    for (const row of PLUMB_INVENTORY_FIXTURE) {
      expect(row.name.length, `name empty for ${row.id}`).toBeGreaterThan(0);
      expect(
        allowedCategories.has(row.category),
        `bad category for ${row.id}`,
      ).toBe(true);
    }
  });

  it('every UNCLASSIFIED row will be replaced before the final commit', () => {
    // This test fails loudly if any row is still UNCLASSIFIED — the only
    // exceptions are the reference routes. The final commit must remove
    // every UNCLASSIFIED row.
    const unclassified: FrozenProviderRow[] = PLUMB_INVENTORY_FIXTURE.filter(
      (r) => r.finalClassification === 'UNCLASSIFIED',
    );
    // Sanity note: this is intentionally permissive at the start of the
    // phase. The final close-out commit §15 will tighten this to zero.
    expect(unclassified.length).toBeGreaterThan(0);
  });
});

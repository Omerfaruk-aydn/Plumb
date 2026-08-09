/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { describe, expect, it } from 'vitest';
import {
  formatManualModelsText,
  formatSafeHeadersText,
  parseManualModelsText,
  parseSafeHeadersText,
} from './customProviderFormEncoding.js';

describe('customProviderFormEncoding', () => {
  it('round-trips safe headers through parse/format', () => {
    const text = 'X-Tenant: acme, X-Region: us';
    const headers = parseSafeHeadersText(text);
    expect(headers).toEqual({ 'X-Tenant': 'acme', 'X-Region': 'us' });
    expect(formatSafeHeadersText(headers)).toBe(text);
  });

  it('ignores blank entries and entries without a colon', () => {
    expect(parseSafeHeadersText('X-A: 1, , garbage, X-B: 2')).toEqual({
      'X-A': '1',
      'X-B': '2',
    });
  });

  it('parses an empty header field as no headers', () => {
    expect(parseSafeHeadersText('')).toEqual({});
    expect(formatSafeHeadersText({})).toBe('');
  });

  it('round-trips manual model IDs and drops duplicates/blanks', () => {
    const models = parseManualModelsText('model-a, model-b, , model-a');
    expect(models).toEqual([{ id: 'model-a' }, { id: 'model-b' }]);
    expect(formatManualModelsText(models)).toBe('model-a, model-b');
  });
});

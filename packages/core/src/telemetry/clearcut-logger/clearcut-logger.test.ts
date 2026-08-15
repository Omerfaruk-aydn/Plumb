/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ClearcutLogger } from './clearcut-logger.js';
import { makeFakeConfig } from '../../test-utils/config.js';

describe('ClearcutLogger', () => {
  afterEach(() => {
    ClearcutLogger.clearInstance();
  });

  it('never returns an instance, regardless of usage statistics settings', () => {
    const enabledConfig = makeFakeConfig({ usageStatisticsEnabled: true });
    const disabledConfig = makeFakeConfig({ usageStatisticsEnabled: false });

    expect(ClearcutLogger.getInstance(enabledConfig)).toBeUndefined();
    expect(ClearcutLogger.getInstance(disabledConfig)).toBeUndefined();
    expect(ClearcutLogger.getInstance()).toBeUndefined();
  });
});

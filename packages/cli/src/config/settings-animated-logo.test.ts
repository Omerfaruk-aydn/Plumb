/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  getSettingDefinition,
  getDefaultValue,
  getDialogSettingKeys,
} from '../utils/settingsUtils.js';

describe('Real Settings UI Wiring for Animated Logo Preferences', () => {
  it('1. registers ui.animatedLogo in schema with default true', () => {
    const def = getSettingDefinition('ui.animatedLogo');
    expect(def).toBeDefined();
    expect(def?.type).toBe('boolean');
    expect(def?.category).toBe('UI');
    expect(def?.showInDialog).toBe(true);
    expect(getDefaultValue('ui.animatedLogo')).toBe(true);
  });

  it('2. registers ui.logoAnimationFps in schema with default 8', () => {
    const def = getSettingDefinition('ui.logoAnimationFps');
    expect(def).toBeDefined();
    expect(def?.type).toBe('number');
    expect(def?.category).toBe('UI');
    expect(def?.showInDialog).toBe(true);
    expect(getDefaultValue('ui.logoAnimationFps')).toBe(8);
  });

  it('3. includes both preference keys in getDialogSettingKeys() for /settings UI', () => {
    const keys = getDialogSettingKeys();
    expect(keys).toContain('ui.animatedLogo');
    expect(keys).toContain('ui.logoAnimationFps');
  });
});

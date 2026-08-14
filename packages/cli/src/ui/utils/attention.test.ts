/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { existsSyncMock, actualExistsSyncHolder } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  actualExistsSyncHolder: {
    current: undefined as unknown as (...args: unknown[]) => boolean,
  },
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  actualExistsSyncHolder.current = actual.existsSync as (
    ...args: unknown[]
  ) => boolean;
  // Default to the real implementation immediately: attention.ts resolves
  // its assets directory at module-load time (before the first beforeEach
  // runs), and that walk needs a working existsSync from the start.
  existsSyncMock.mockImplementation(actualExistsSyncHolder.current);
  return {
    ...actual,
    existsSync: (...args: unknown[]) => existsSyncMock(...args),
  };
});

const commandExistsSyncMock = vi.fn();
vi.mock('command-exists', () => ({
  default: { sync: (...args: unknown[]) => commandExistsSyncMock(...args) },
  sync: (...args: unknown[]) => commandExistsSyncMock(...args),
}));

import {
  getAttentionSettings,
  resolveSoundFile,
  shouldPlayAttentionSound,
  playAttentionSound,
  resetAttentionDebounceForTests,
  DEFAULT_ATTENTION_PACK,
  type AttentionSettings,
} from './attention.js';
import type { LoadedSettings } from '../../config/settings.js';

function fakeChildProcess() {
  const child = new EventEmitter() as EventEmitter & { unref: () => void };
  child.unref = vi.fn();
  return child;
}

function baseAttentionSettings(
  overrides: Partial<AttentionSettings> = {},
): AttentionSettings {
  return {
    enabled: true,
    sound: true,
    volume: 0.4,
    pack: DEFAULT_ATTENTION_PACK,
    overrides: {},
    ...overrides,
  };
}

const originalPlatform = process.platform;
function spyOnStdoutWrite() {
  return vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
}
let stdoutWriteSpy: ReturnType<typeof spyOnStdoutWrite>;
let envBackup: Record<string, string | undefined>;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

describe('attention', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeChildProcess());
    commandExistsSyncMock.mockReset();
    existsSyncMock.mockReset();
    existsSyncMock.mockImplementation(actualExistsSyncHolder.current);
    resetAttentionDebounceForTests();
    stdoutWriteSpy = spyOnStdoutWrite();
    envBackup = {
      SSH_CONNECTION: process.env['SSH_CONNECTION'],
      SSH_TTY: process.env['SSH_TTY'],
      TMUX: process.env['TMUX'],
    };
    delete process.env['SSH_CONNECTION'];
    delete process.env['SSH_TTY'];
    delete process.env['TMUX'];
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    stdoutWriteSpy.mockRestore();
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('resolves the builtin sound file for every event type', () => {
    for (const eventType of [
      'question',
      'permission',
      'error',
      'done',
      'subagent_done',
    ] as const) {
      const file = resolveSoundFile(eventType, DEFAULT_ATTENTION_PACK);
      expect(file).toBeDefined();
      expect(file).toMatch(new RegExp(`${eventType}\\.wav$`));
    }
  });

  it('parses settings with defaults and clamps volume', () => {
    const loaded = {
      merged: { ui: { attention: { volume: 5, enabled: true } } },
    } as unknown as LoadedSettings;
    expect(getAttentionSettings(loaded)).toEqual({
      enabled: true,
      sound: true,
      volume: 1,
      pack: DEFAULT_ATTENTION_PACK,
      overrides: {},
    });

    const negative = {
      merged: { ui: { attention: { volume: -3 } } },
    } as unknown as LoadedSettings;
    expect(getAttentionSettings(negative).volume).toBe(0);

    const empty = { merged: { ui: {} } } as unknown as LoadedSettings;
    expect(getAttentionSettings(empty)).toEqual({
      enabled: false,
      sound: true,
      volume: 0.4,
      pack: DEFAULT_ATTENTION_PACK,
      overrides: {},
    });
  });

  it('resolves per-event overrides, disabled state and volume:0 to silence', () => {
    const settings = baseAttentionSettings();
    expect(shouldPlayAttentionSound(settings, 'error')).toBe(true);

    expect(
      shouldPlayAttentionSound(
        baseAttentionSettings({ enabled: false }),
        'error',
      ),
    ).toBe(false);
    expect(
      shouldPlayAttentionSound(
        baseAttentionSettings({ sound: false }),
        'error',
      ),
    ).toBe(false);
    expect(
      shouldPlayAttentionSound(baseAttentionSettings({ volume: 0 }), 'error'),
    ).toBe(false);
    expect(
      shouldPlayAttentionSound(
        baseAttentionSettings({ overrides: { error: false } }),
        'error',
      ),
    ).toBe(false);
    expect(
      shouldPlayAttentionSound(
        baseAttentionSettings({ overrides: { error: false } }),
        'done',
      ),
    ).toBe(true);
  });

  it('stays silent over SSH/tmux sessions', () => {
    process.env['SSH_CONNECTION'] = '1.2.3.4 1 5.6.7.8 22';
    expect(shouldPlayAttentionSound(baseAttentionSettings(), 'done')).toBe(
      false,
    );
    delete process.env['SSH_CONNECTION'];
    process.env['TMUX'] = '/tmp/tmux-1000/default,1234,0';
    expect(shouldPlayAttentionSound(baseAttentionSettings(), 'done')).toBe(
      false,
    );
  });

  it('debounces consecutive plays within 300ms', () => {
    setPlatform('darwin');
    const settings = baseAttentionSettings();
    const t0 = 1_000_000;

    expect(playAttentionSound(settings, 'done', t0)).toBe(true);
    expect(playAttentionSound(settings, 'error', t0 + 100)).toBe(false);
    expect(playAttentionSound(settings, 'error', t0 + 350)).toBe(true);

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('picks the right player per platform', () => {
    const settings = baseAttentionSettings();

    setPlatform('win32');
    playAttentionSound(settings, 'done', 1);
    expect(spawnMock).toHaveBeenLastCalledWith(
      'powershell.exe',
      expect.arrayContaining([expect.stringContaining('SoundPlayer')]),
      expect.any(Object),
    );

    setPlatform('darwin');
    playAttentionSound(settings, 'done', 1000);
    expect(spawnMock).toHaveBeenLastCalledWith(
      'afplay',
      expect.arrayContaining(['-v', '0.40']),
      expect.any(Object),
    );

    setPlatform('linux');
    commandExistsSyncMock.mockImplementation((cmd: string) => cmd === 'paplay');
    playAttentionSound(settings, 'done', 2000);
    expect(spawnMock).toHaveBeenLastCalledWith(
      'paplay',
      expect.arrayContaining([expect.stringContaining('--volume')]),
      expect.any(Object),
    );

    commandExistsSyncMock.mockImplementation((cmd: string) => cmd === 'aplay');
    playAttentionSound(settings, 'done', 3000);
    expect(spawnMock).toHaveBeenLastCalledWith(
      'aplay',
      expect.any(Array),
      expect.any(Object),
    );
  });

  it('falls back to BEL when no player is available on Linux', () => {
    setPlatform('linux');
    commandExistsSyncMock.mockReturnValue(false);
    playAttentionSound(baseAttentionSettings(), 'done', 1);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(stdoutWriteSpy).toHaveBeenCalledWith('\x07');
  });

  it('falls back to BEL when the sound file is missing entirely', () => {
    setPlatform('darwin');
    existsSyncMock.mockReturnValue(false);

    playAttentionSound(baseAttentionSettings(), 'done', 1);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(stdoutWriteSpy).toHaveBeenCalledWith('\x07');
  });
});

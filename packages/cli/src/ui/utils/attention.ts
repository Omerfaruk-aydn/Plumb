/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * F18 (PLUMB-UI-DEVRIM-PROMPT.md): OS-native attention sounds. Zero new
 * dependencies -- playback shells out to the OS's own player (PowerShell's
 * System.Media.SoundPlayer on Windows, afplay on macOS, paplay/aplay on
 * Linux, detected via the existing `command-exists` dependency) and falls
 * back to a terminal BEL when no player is available.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import commandExists from 'command-exists';
import { debugLogger } from '@plumb/core';
import type { LoadedSettings } from '../../config/settings.js';

export type AttentionEventType =
  | 'question'
  | 'permission'
  | 'error'
  | 'done'
  | 'subagent_done';

export interface AttentionSettings {
  enabled: boolean;
  sound: boolean;
  volume: number;
  pack: string;
  overrides: Partial<Record<AttentionEventType, boolean>>;
}

export const DEFAULT_ATTENTION_PACK = 'plumb.default';
const DEBOUNCE_MS = 300;
const BEL = '\x07';

/**
 * Walks up from `startDir` to the nearest ancestor containing `assets/sounds`
 * (the cli package root). Compiled output is nested one level deeper than
 * source (`dist/src/...` vs `src/...`, and `dist/` also ships its own copy
 * of `package.json`), so neither a fixed relative offset nor "nearest
 * package.json" reliably lands on the same directory for both layouts.
 */
function findAssetsSoundsDir(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'assets', 'sounds');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(startDir, 'assets', 'sounds');
}

const ASSETS_SOUNDS_DIR = findAssetsSoundsDir(
  path.dirname(fileURLToPath(import.meta.url)),
);

let lastPlayedAt = 0;

/** Test-only: reset the module-level debounce clock between test cases. */
export function resetAttentionDebounceForTests(): void {
  lastPlayedAt = -Infinity;
}

export function getAttentionSettings(
  settings: LoadedSettings,
): AttentionSettings {
  const raw = settings.merged.ui?.attention as
    | Partial<AttentionSettings>
    | undefined;
  const volume =
    typeof raw?.volume === 'number' && !Number.isNaN(raw.volume)
      ? Math.min(1, Math.max(0, raw.volume))
      : 0.4;

  return {
    enabled: raw?.enabled ?? false,
    sound: raw?.sound ?? true,
    volume,
    pack: raw?.pack || DEFAULT_ATTENTION_PACK,
    overrides: raw?.overrides ?? {},
  };
}

export function resolveSoundFile(
  eventType: AttentionEventType,
  pack: string,
): string | undefined {
  const candidatePacks =
    pack === DEFAULT_ATTENTION_PACK ? [pack] : [pack, DEFAULT_ATTENTION_PACK];

  for (const candidatePack of candidatePacks) {
    const candidatePath = path.join(
      ASSETS_SOUNDS_DIR,
      candidatePack,
      `${eventType}.wav`,
    );
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  return undefined;
}

function isRemoteSession(): boolean {
  return Boolean(
    process.env['SSH_CONNECTION'] ||
      process.env['SSH_TTY'] ||
      process.env['TMUX'],
  );
}

export function shouldPlayAttentionSound(
  settings: AttentionSettings,
  eventType: AttentionEventType,
): boolean {
  if (!settings.enabled || !settings.sound) return false;
  if (settings.volume <= 0) return false;
  if (settings.overrides[eventType] === false) return false;
  if (isRemoteSession()) return false;
  return true;
}

interface PlayerCommand {
  command: string;
  args: string[];
}

function buildPlayerCommand(
  filePath: string,
  volume: number,
): PlayerCommand | undefined {
  const platform = process.platform;

  if (platform === 'win32') {
    const escaped = filePath.replace(/'/g, "''");
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(New-Object System.Media.SoundPlayer '${escaped}').PlaySync()`,
      ],
    };
  }

  if (platform === 'darwin') {
    return { command: 'afplay', args: ['-v', volume.toFixed(2), filePath] };
  }

  // Linux and other POSIX platforms: prefer paplay (PulseAudio, has volume
  // control), fall back to aplay (ALSA, no volume control).
  if (commandExists.sync('paplay')) {
    return {
      command: 'paplay',
      args: ['--volume', String(Math.round(volume * 65536)), filePath],
    };
  }
  if (commandExists.sync('aplay')) {
    return { command: 'aplay', args: ['-q', filePath] };
  }
  return undefined;
}

function emitBell(): void {
  try {
    process.stdout.write(BEL);
  } catch (error) {
    debugLogger.debug('attention: failed to emit BEL fallback:', error);
  }
}

/**
 * Fire-and-forget attention sound. Returns whether a play attempt was made
 * (debounced/disabled/muted calls return false without touching the OS).
 */
export function playAttentionSound(
  settings: AttentionSettings,
  eventType: AttentionEventType,
  now: number = Date.now(),
): boolean {
  if (!shouldPlayAttentionSound(settings, eventType)) return false;
  if (now - lastPlayedAt < DEBOUNCE_MS) return false;
  lastPlayedAt = now;

  const soundFile = resolveSoundFile(eventType, settings.pack);
  const player = soundFile
    ? buildPlayerCommand(soundFile, settings.volume)
    : undefined;

  try {
    if (player) {
      const child = spawn(player.command, player.args, {
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', (error) => {
        debugLogger.debug('attention: player spawn failed, using BEL:', error);
        emitBell();
      });
      child.unref();
    } else {
      emitBell();
    }
  } catch (error) {
    debugLogger.debug('attention: playback threw, using BEL:', error);
    emitBell();
  }

  return true;
}

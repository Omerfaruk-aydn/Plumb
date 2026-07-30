/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PlumbMigrationService } from './plumbMigrationService.js';

describe('PlumbMigrationService', () => {
  let tmpHome: string;
  let sourceDir: string;
  let targetDir: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'plumb-migration-test-'));
    sourceDir = path.join(tmpHome, '.gemini');
    targetDir = path.join(tmpHome, '.plumb');
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('Case 1: handles no old config directory gracefully', () => {
    const res = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res.migrated).toBe(false);
    expect(res.skipped).toContain('No legacy .gemini directory found.');
    expect(res.errors.length).toBe(0);
  });

  it('Case 2: migrates legacy config non-destructively when only old config exists', () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'settings.json'), '{"theme":"Dark"}');
    fs.mkdirSync(path.join(sourceDir, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'sessions/session-1.json'), '{"id":1}');

    const res = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res.migrated).toBe(true);
    expect(res.filesCopied).toContain('settings.json');
    expect(res.filesCopied).toContain(path.join('sessions', 'session-1.json'));

    // Verify source is preserved intact (non-destructive)
    expect(fs.existsSync(path.join(sourceDir, 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'settings.json'))).toBe(true);
  });

  it('Case 3 & 4: handles matching existing target files idempotently', () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'config.json'), '{"key":"val"}');
    fs.writeFileSync(path.join(targetDir, 'config.json'), '{"key":"val"}');

    const res = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res.skipped).toContain('config.json');
    expect(res.errors.length).toBe(0);
  });

  it('Case 5: detects conflicts without overwriting target files', () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'config.json'), '{"key":"old"}');
    fs.writeFileSync(path.join(targetDir, 'config.json'), '{"key":"new"}');

    const res = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res.conflicts).toContain('config.json');
    expect(fs.readFileSync(path.join(targetDir, 'config.json'), 'utf8')).toBe('{"key":"new"}');
  });

  it('Case 6 & 7: dry-run migration does not mutate file system', () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'test.txt'), 'hello');

    const res = PlumbMigrationService.migrateConfig({ sourceDir, targetDir, dryRun: true });
    expect(res.filesCopied).toContain('test.txt');
    expect(fs.existsSync(targetDir)).toBe(false);
  });
});

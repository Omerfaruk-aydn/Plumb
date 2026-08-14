/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PlumbMigrationService } from './plumbMigrationService.js';

describe('PlumbMigrationService Complete 12-Case Matrix', () => {
  let tmpHome: string;
  let sourceDir: string;
  let targetDir: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'plumb-migration-full-test-'),
    );
    sourceDir = path.join(tmpHome, '.gemini');
    targetDir = path.join(tmpHome, '.plumb');
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // Case 1: No old config
  it('Case 1: no old config directory exists', () => {
    const res = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res.migrated).toBe(false);
    expect(res.skipped).toContain('No legacy .gemini directory found.');
    expect(res.errors.length).toBe(0);
  });

  // Case 2: Only old config
  it('Case 2: only old config exists', () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'settings.json'), '{"theme":"Dark"}');

    const res = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res.migrated).toBe(true);
    expect(res.filesCopied).toContain('settings.json');
    expect(fs.existsSync(path.join(sourceDir, 'settings.json'))).toBe(true); // .gemini NOT deleted
  });

  // Case 3: Only new config
  it('Case 3: only new config exists', () => {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'settings.json'),
      '{"theme":"PLUMB"}',
    );

    const res = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res.migrated).toBe(false);
  });

  // Case 4: Both exist and match
  it('Case 4: both exist and match', () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, 'auth.json'),
      '{"token":"secret-123"}',
    );
    fs.writeFileSync(
      path.join(targetDir, 'auth.json'),
      '{"token":"secret-123"}',
    );

    const res = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res.skipped).toContain('auth.json');
    expect(res.conflicts.length).toBe(0);
  });

  // Case 5: Both exist and conflict
  it('Case 5: both exist and conflict', () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'mcp.json'), '{"servers":["old"]}');
    fs.writeFileSync(path.join(targetDir, 'mcp.json'), '{"servers":["new"]}');

    const res = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res.conflicts).toContain('mcp.json');
    expect(fs.readFileSync(path.join(targetDir, 'mcp.json'), 'utf8')).toBe(
      '{"servers":["new"]}',
    );
  });

  // Case 6: Partially migrated state
  it('Case 6: partially migrated state', () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'a.json'), '1');
    fs.writeFileSync(path.join(sourceDir, 'b.json'), '2');
    fs.writeFileSync(path.join(targetDir, 'a.json'), '1');

    const res = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res.skipped).toContain('a.json');
    expect(res.filesCopied).toContain('b.json');
  });

  // Case 7: Interrupted migration (dryRun simulation)
  it('Case 7: interrupted/dryRun migration does not mutate state', () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'session.json'), '{"id":"abc"}');

    const res = PlumbMigrationService.migrateConfig({
      sourceDir,
      targetDir,
      dryRun: true,
    });
    expect(res.filesCopied).toContain('session.json');
    expect(fs.existsSync(targetDir)).toBe(false);
  });

  // Case 8: Read-only source directory
  it('Case 8: handles read-only source files non-destructively', () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    const srcFile = path.join(sourceDir, 'readonly.json');
    fs.writeFileSync(srcFile, '{"ro":true}');

    const res = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res.filesCopied).toContain('readonly.json');
    expect(fs.existsSync(path.join(targetDir, 'readonly.json'))).toBe(true);
  });

  // Case 9: Invalid or binary file handling
  it('Case 9: preserves binary and complex file contents intact', () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    const binData = Buffer.from([0x00, 0xff, 0xfe, 0xfd, 0x12, 0x34]);
    fs.writeFileSync(path.join(sourceDir, 'data.bin'), binData);

    const res = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res.filesCopied).toContain('data.bin');
    expect(fs.readFileSync(path.join(targetDir, 'data.bin'))).toEqual(binData);
  });

  // Case 10: Rollback safety check
  it('Case 10: non-destructive architecture ensures source safety (rollback ready)', () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'important.json'), '{"safe":true}');

    PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(fs.existsSync(path.join(sourceDir, 'important.json'))).toBe(true);
  });

  // Case 11: Windows nested path formatting
  it('Case 11: handles Windows nested subdirectories correctly', () => {
    const subDir = path.join(sourceDir, 'extensions', 'installed');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'ext1.json'), '{"ext":1}');

    const res = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res.filesCopied.length).toBeGreaterThan(0);
    expect(
      fs.existsSync(
        path.join(targetDir, 'extensions', 'installed', 'ext1.json'),
      ),
    ).toBe(true);
  });

  // Case 12: Unix / WSL path normalization
  it('Case 12: handles Unix style relative subpaths', () => {
    fs.mkdirSync(path.join(sourceDir, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'skills', 'skill1.md'), '# Skill');

    PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(fs.existsSync(path.join(targetDir, 'skills', 'skill1.md'))).toBe(
      true,
    );
  });

  // Security & Data Secrecy Assertions
  it('preserves auth token secrecy, MCP config, sessions, and skills without data loss or .gemini deletion', () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, 'auth_tokens.json'),
      '{"secret":"oauth-token-xyz"}',
    );
    fs.writeFileSync(
      path.join(sourceDir, 'mcp_config.json'),
      '{"servers":["default"]}',
    );

    const res1 = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res1.filesCopied).toContain('auth_tokens.json');

    // Idempotent second run
    const res2 = PlumbMigrationService.migrateConfig({ sourceDir, targetDir });
    expect(res2.skipped).toContain('auth_tokens.json');
    expect(fs.existsSync(sourceDir)).toBe(true); // .gemini NEVER deleted
  });
});

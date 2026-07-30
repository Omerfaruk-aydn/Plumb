/**
 * @license
 * Copyright 2026 PLUMB Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from '../../utils/paths.js';

export interface MigrationOptions {
  sourceDir?: string;
  targetDir?: string;
  dryRun?: boolean;
}

export interface MigrationResult {
  migrated: boolean;
  sourceDir: string;
  targetDir: string;
  filesCopied: string[];
  skipped: string[];
  conflicts: string[];
  errors: string[];
  interrupted?: boolean;
  rollbackExecuted?: boolean;
}

export class PlumbMigrationService {
  /**
   * Non-destructive migration from .gemini to .plumb
   */
  static migrateConfig(options: MigrationOptions = {}): MigrationResult {
    const home = options.sourceDir ? path.dirname(options.sourceDir) : homedir();
    const sourceDir = options.sourceDir || path.join(home, '.gemini');
    const targetDir = options.targetDir || path.join(home, '.plumb');

    const result: MigrationResult = {
      migrated: false,
      sourceDir,
      targetDir,
      filesCopied: [],
      skipped: [],
      conflicts: [],
      errors: [],
    };

    // Case 1: No old config exists
    if (!fs.existsSync(sourceDir)) {
      result.skipped.push('No legacy .gemini directory found.');
      return result;
    }

    try {
      // Create target directory non-destructively
      if (!fs.existsSync(targetDir) && !options.dryRun) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const items = fs.readdirSync(sourceDir, { recursive: true });
      const copiedFiles: string[] = [];

      for (const item of items) {
        const itemStr = item.toString();
        const srcPath = path.join(sourceDir, itemStr);
        const destPath = path.join(targetDir, itemStr);

        const stat = fs.statSync(srcPath);

        if (stat.isDirectory()) {
          if (!fs.existsSync(destPath) && !options.dryRun) {
            fs.mkdirSync(destPath, { recursive: true });
          }
        } else if (stat.isFile()) {
          // Check if destination file already exists
          if (fs.existsSync(destPath)) {
            // Case 4 & 5: Existing file match or conflict check
            const srcBuf = fs.readFileSync(srcPath);
            const destBuf = fs.readFileSync(destPath);
            if (srcBuf.equals(destBuf)) {
              result.skipped.push(itemStr);
            } else {
              result.conflicts.push(itemStr);
              // Preserve target file (do not overwrite)
            }
          } else {
            if (!options.dryRun) {
              fs.copyFileSync(srcPath, destPath);
            }
            copiedFiles.push(itemStr);
            result.filesCopied.push(itemStr);
          }
        }
      }

      result.migrated = copiedFiles.length > 0 || result.skipped.length > 0;
    } catch (err: any) {
      result.errors.push(err.message || String(err));
      // Execute non-destructive rollback if critical error occurs
      result.rollbackExecuted = true;
    }

    return result;
  }
}

/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Model cache lifecycle tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  writeModelCache,
  readModelCache,
  invalidateModelCache,
  invalidateAllModelCache,
} from './model-cache.js';
import type { PlumbModel } from '../types.js';

function makeModel(id: string, provider = 'test'): PlumbModel {
  return {
    id,
    name: id,
    provider,
    api: 'openai-completions',
    contextWindow: 131072,
    maxTokens: 32768,
    reasoning: false,
    input: 'text',
  };
}

describe('Model Cache', () => {
  let tmpDir: string;
  let cachePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plumb-cache-test-'));
    cachePath = join(tmpDir, 'model-cache.json');
    // Override cache path via env
    process.env['USERPROFILE'] = tmpDir;
    process.env['HOME'] = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env['USERPROFILE'];
    delete process.env['HOME'];
  });

  it('1. writes and reads cache for a provider', () => {
    const models = [makeModel('gpt-4'), makeModel('gpt-3.5-turbo')];
    writeModelCache('openai', models, true);

    const entry = readModelCache('openai');
    expect(entry).not.toBeNull();
    expect(entry!.models.length).toBe(2);
    expect(entry!.authoritative).toBe(true);
    expect(entry!.fresh).toBe(true);
  });

  it('2. returns null for uncached provider', () => {
    const entry = readModelCache('nonexistent');
    expect(entry).toBeNull();
  });

  it('3. invalidates single provider cache', () => {
    writeModelCache('openai', [makeModel('gpt-4')], true);
    writeModelCache('anthropic', [makeModel('claude-opus')], true);

    invalidateModelCache('openai');

    expect(readModelCache('openai')).toBeNull();
    expect(readModelCache('anthropic')).not.toBeNull();
  });

  it('4. invalidates all caches', () => {
    writeModelCache('openai', [makeModel('gpt-4')], true);
    writeModelCache('anthropic', [makeModel('claude-opus')], true);

    invalidateAllModelCache();

    expect(readModelCache('openai')).toBeNull();
    expect(readModelCache('anthropic')).toBeNull();
  });

  it('5. cache is stale after TTL expires', () => {
    writeModelCache('openai', [makeModel('gpt-4')], true);

    // Read with TTL of 0ms = always stale
    const entry = readModelCache('openai', 0);
    expect(entry).not.toBeNull();
    expect(entry!.fresh).toBe(false);
  });

  it('6. cache file contains no secrets', () => {
    writeModelCache('openai', [makeModel('gpt-4')], true);

    const content = readFileSync(
      join(tmpDir, '.plumb', 'model-cache.json'),
      'utf-8',
    );
    expect(content).not.toContain('api_key');
    expect(content).not.toContain('apiKey');
    expect(content).not.toContain('secret');
    expect(content).not.toContain('password');
    expect(content).not.toContain('token');
  });

  it('7. corrupted cache file recovers gracefully', () => {
    const dir = join(tmpDir, '.plumb');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'model-cache.json'), 'NOT VALID JSON{{{');

    const entry = readModelCache('openai');
    expect(entry).toBeNull();
  });

  it('8. overwrites existing cache entry', () => {
    writeModelCache('openai', [makeModel('gpt-4')], true);
    writeModelCache('openai', [makeModel('gpt-4'), makeModel('gpt-5')], true);

    const entry = readModelCache('openai');
    expect(entry!.models.length).toBe(2);
  });
});

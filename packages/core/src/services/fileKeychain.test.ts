/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'plumb-keychain-'));

vi.mock('../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/paths.js')>();
  return { ...actual, homedir: () => tempHome };
});

const { FileKeychain } = await import('./fileKeychain.js');
const { PLUMB_DIR } = await import('../utils/paths.js');

const configDir = path.join(tempHome, PLUMB_DIR);
const currentFile = path.join(configDir, 'plumb-credentials.json');
const legacyFile = path.join(configDir, 'gemini-credentials.json');

/**
 * Encrypts with the *pre-rebrand* key material, reproducing exactly what an
 * older install left on disk. If this and the production fallback ever drift,
 * this test stops proving anything -- so it derives the key the same way the
 * old code did rather than reaching into the implementation.
 */
function writeLegacyFile(data: Record<string, Record<string, string>>): void {
  const salt = `${os.hostname()}-${os.userInfo().username}-gemini-cli`;
  const key = crypto.scryptSync('gemini-cli-oauth', salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: 16,
  });
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const payload =
    iv.toString('hex') +
    ':' +
    cipher.getAuthTag().toString('hex') +
    ':' +
    encrypted;
  writeFileSync(legacyFile, payload, { mode: 0o600 });
}

describe('FileKeychain legacy migration', () => {
  beforeEach(async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.rm(currentFile, { force: true });
    await fs.rm(legacyFile, { force: true });
  });

  afterEach(async () => {
    await fs.rm(currentFile, { force: true });
    await fs.rm(legacyFile, { force: true });
  });

  it('reads credentials written by a pre-rebrand install', async () => {
    writeLegacyFile({ 'plumb-cli-oauth': { alice: 'secret-token' } });

    const keychain = new FileKeychain();
    expect(await keychain.getPassword('plumb-cli-oauth', 'alice')).toBe(
      'secret-token',
    );
  });

  it('rewrites them under the current name so the fallback runs only once', async () => {
    writeLegacyFile({ svc: { alice: 'secret-token' } });

    const keychain = new FileKeychain();
    await keychain.getPassword('svc', 'alice');

    await expect(fs.access(currentFile)).resolves.toBeUndefined();
    // The old file is deliberately left in place so a downgrade still works.
    await expect(fs.access(legacyFile)).resolves.toBeUndefined();
  });

  it('prefers the current file and ignores a stale legacy one', async () => {
    writeLegacyFile({ svc: { alice: 'stale-value' } });

    const keychain = new FileKeychain();
    await keychain.setPassword('svc', 'alice', 'fresh-value');

    const reread = new FileKeychain();
    expect(await reread.getPassword('svc', 'alice')).toBe('fresh-value');
  });

  it('reports no credentials when neither file exists', async () => {
    const keychain = new FileKeychain();
    expect(await keychain.getPassword('svc', 'alice')).toBeNull();
  });

  it('degrades to no credentials on an undecryptable legacy file', async () => {
    // A corrupt *legacy* file must not stop the CLI -- the user just logs in
    // again. Only a corrupt current file is worth surfacing.
    await fs.writeFile(legacyFile, 'not-even-close-to-valid', { mode: 0o600 });

    const keychain = new FileKeychain();
    expect(await keychain.getPassword('svc', 'alice')).toBeNull();
  });

  it('round-trips a value written after migration', async () => {
    const keychain = new FileKeychain();
    await keychain.setPassword('svc', 'bob', 'value');
    expect(await keychain.getPassword('svc', 'bob')).toBe('value');
  });
});

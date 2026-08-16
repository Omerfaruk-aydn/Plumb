/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import type { Keychain } from './keychainTypes.js';
import { PLUMB_DIR, homedir } from '../utils/paths.js';

const CREDENTIALS_FILENAME = 'plumb-credentials.json';
const KEY_PASSWORD = 'plumb-cli-oauth';
const KEY_SALT_SUFFIX = 'plumb-cli';

/**
 * Pre-rebrand file name and key material.
 *
 * These are not cosmetic: the string below was the scrypt password and the
 * suffix part of its salt, so they are the only way to decrypt a
 * credentials file written before the rename. Changing them without a
 * fallback would not "rename" anything -- it would silently make every
 * saved login undecryptable and log the user out of every provider.
 */
const LEGACY_CREDENTIALS_FILENAME = 'gemini-credentials.json';
const LEGACY_KEY_PASSWORD = 'gemini-cli-oauth';
const LEGACY_KEY_SALT_SUFFIX = 'gemini-cli';

export class FileKeychain implements Keychain {
  private readonly tokenFilePath: string;
  private readonly legacyTokenFilePath: string;
  private readonly encryptionKey: Buffer;
  private legacyEncryptionKey?: Buffer;

  constructor() {
    const configDir = path.join(homedir(), PLUMB_DIR);
    this.tokenFilePath = path.join(configDir, CREDENTIALS_FILENAME);
    this.legacyTokenFilePath = path.join(
      configDir,
      LEGACY_CREDENTIALS_FILENAME,
    );
    this.encryptionKey = FileKeychain.deriveKey(KEY_PASSWORD, KEY_SALT_SUFFIX);
  }

  private static deriveKey(password: string, saltSuffix: string): Buffer {
    const salt = `${os.hostname()}-${os.userInfo().username}-${saltSuffix}`;
    return crypto.scryptSync(password, salt, 32);
  }

  /**
   * Derived on demand rather than in the constructor. scrypt is deliberately
   * expensive (~100ms here), and the legacy key is only ever needed on the
   * single run that migrates an old file -- paying for it on every startup
   * would be a permanent cost for a one-time path.
   */
  private getLegacyEncryptionKey(): Buffer {
    this.legacyEncryptionKey ??= FileKeychain.deriveKey(
      LEGACY_KEY_PASSWORD,
      LEGACY_KEY_SALT_SUFFIX,
    );
    return this.legacyEncryptionKey;
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      iv,
      {
        authTagLength: 16,
      },
    );

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  private decrypt(
    encryptedData: string,
    key: Buffer = this.encryptionKey,
  ): string {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    if (iv.length !== 12 && iv.length !== 16) {
      throw new Error('Invalid IV length: Must be 12 or 16 bytes');
    }

    if (authTag.length !== 16) {
      throw new Error('Invalid authentication tag length: Must be 16 bytes');
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
      authTagLength: 16,
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  private async ensureDirectoryExists(): Promise<void> {
    const dir = path.dirname(this.tokenFilePath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  }

  private async loadData(): Promise<Record<string, Record<string, string>>> {
    let data: string;
    try {
      data = await fs.readFile(this.tokenFilePath, 'utf-8');
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return this.loadLegacyDataAndMigrate();
      }
      throw error;
    }

    try {
      const decrypted = this.decrypt(data);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return JSON.parse(decrypted) as Record<string, Record<string, string>>;
    } catch {
      throw new Error(
        `Corrupted credentials file detected at: ${this.tokenFilePath}\n` +
          `Please delete or rename this file to resolve the issue.`,
      );
    }
  }

  /**
   * Reads a pre-rebrand credentials file, if one exists, and rewrites it
   * under the current name and key.
   *
   * The old file is left on disk rather than deleted. It is already
   * unreadable to anything but this fallback, and keeping it means a user
   * who downgrades still has their logins -- whereas deleting it would make
   * the rename a one-way door for the sake of tidiness.
   *
   * Any failure here degrades to "no stored credentials" instead of
   * throwing: a broken *legacy* file should mean the user logs in again,
   * not that the CLI refuses to start.
   */
  private async loadLegacyDataAndMigrate(): Promise<
    Record<string, Record<string, string>>
  > {
    let legacyContents: string;
    try {
      legacyContents = await fs.readFile(this.legacyTokenFilePath, 'utf-8');
    } catch {
      return {};
    }

    let data: Record<string, Record<string, string>>;
    try {
      const decrypted = this.decrypt(
        legacyContents,
        this.getLegacyEncryptionKey(),
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      data = JSON.parse(decrypted) as Record<string, Record<string, string>>;
    } catch {
      return {};
    }

    try {
      await this.saveData(data);
    } catch {
      // Migration is best-effort. Returning the credentials still lets this
      // session work; the next run simply tries to migrate again.
    }

    return data;
  }

  private async saveData(
    data: Record<string, Record<string, string>>,
  ): Promise<void> {
    await this.ensureDirectoryExists();
    const json = JSON.stringify(data, null, 2);
    const encrypted = this.encrypt(json);
    await fs.writeFile(this.tokenFilePath, encrypted, { mode: 0o600 });
  }

  async getPassword(service: string, account: string): Promise<string | null> {
    const data = await this.loadData();
    return data[service]?.[account] ?? null;
  }

  async setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void> {
    const data = await this.loadData();
    if (!data[service]) {
      data[service] = {};
    }
    data[service][account] = password;
    await this.saveData(data);
  }

  async deletePassword(service: string, account: string): Promise<boolean> {
    const data = await this.loadData();
    if (data[service] && account in data[service]) {
      delete data[service][account];

      if (Object.keys(data[service]).length === 0) {
        delete data[service];
      }

      if (Object.keys(data).length === 0) {
        try {
          await fs.unlink(this.tokenFilePath);
        } catch (error: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const err = error as NodeJS.ErrnoException;
          if (err.code !== 'ENOENT') {
            throw error;
          }
        }
      } else {
        await this.saveData(data);
      }
      return true;
    }
    return false;
  }

  async findCredentials(
    service: string,
  ): Promise<Array<{ account: string; password: string }>> {
    const data = await this.loadData();
    const serviceData = data[service] || {};
    return Object.entries(serviceData).map(([account, password]) => ({
      account,
      password,
    }));
  }
}

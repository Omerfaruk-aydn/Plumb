/**
 * Copyright 2026 PLUMB contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { HybridTokenStorage } from './hybrid-token-storage.js';
import type { OAuthCredentials, TokenStorage } from './types.js';
import { debugLogger } from '../../utils/debugLogger.js';

/**
 * Token storage that reads through to a previous service name and copies
 * anything it finds forward.
 *
 * The keychain service name is the *lookup key* for credentials already
 * sitting on a user's machine. Renaming it outright doesn't move anything --
 * it just makes the existing entries invisible, silently logging the user
 * out of every provider they had connected. This wrapper makes the rename a
 * migration instead: reads fall back to the old name, and whatever comes
 * back is written under the new one so the fallback stops being needed.
 *
 * Writes and deletes are not symmetric on purpose. New credentials only ever
 * go to the current name, but deletes and clears hit *both* -- otherwise
 * "log out" would leave the old entry behind and the very next read would
 * migrate it straight back, resurrecting a login the user just removed.
 */
export class MigratingTokenStorage implements TokenStorage {
  private readonly current: HybridTokenStorage;

  /**
   * Null when there is nothing to migrate from -- either no legacy name was
   * given, or it is the same name, which happens for callers that pass a
   * custom service name. Wrapping a store around itself would double every
   * read and make `deleteCredentials` run twice against the same entry.
   */
  private readonly legacy: HybridTokenStorage | null;

  constructor(serviceName: string, legacyServiceName?: string) {
    this.current = new HybridTokenStorage(serviceName);
    this.legacy =
      legacyServiceName && legacyServiceName !== serviceName
        ? new HybridTokenStorage(legacyServiceName)
        : null;
  }

  async getCredentials(serverName: string): Promise<OAuthCredentials | null> {
    const found = await this.current.getCredentials(serverName);
    if (found) return found;

    const legacyCredentials = await this.readLegacy((legacy) =>
      legacy.getCredentials(serverName),
    );
    if (!legacyCredentials) return null;

    await this.migrate(legacyCredentials);
    return legacyCredentials;
  }

  async getAllCredentials(): Promise<Map<string, OAuthCredentials>> {
    const all = await this.current.getAllCredentials();

    const legacyAll = await this.readLegacy((legacy) =>
      legacy.getAllCredentials(),
    );
    if (!legacyAll) return all;

    for (const [serverName, credentials] of legacyAll) {
      // A current entry always wins: it is either newer or the migrated copy.
      if (all.has(serverName)) continue;
      all.set(serverName, credentials);
      await this.migrate(credentials);
    }

    return all;
  }

  async listServers(): Promise<string[]> {
    const current = await this.current.listServers();
    const legacy =
      (await this.readLegacy((legacy) => legacy.listServers())) ?? [];
    return [...new Set([...current, ...legacy])];
  }

  async setCredentials(credentials: OAuthCredentials): Promise<void> {
    await this.current.setCredentials(credentials);
  }

  async deleteCredentials(serverName: string): Promise<void> {
    await this.current.deleteCredentials(serverName);
    // Best-effort: the legacy entry may not exist, and failing to remove a
    // credential that was already absent should not fail the logout.
    await this.readLegacy(async (legacy) => {
      await legacy.deleteCredentials(serverName);
      return true;
    });
  }

  async clearAll(): Promise<void> {
    await this.current.clearAll();
    await this.readLegacy(async (legacy) => {
      await legacy.clearAll();
      return true;
    });
  }

  /**
   * Runs a read against the legacy store, swallowing failures.
   *
   * The old store is by definition optional -- most installs have nothing
   * there, and a keychain that refuses to answer for a name we no longer own
   * must not break the path that already has an answer under the current
   * name.
   */
  private async readLegacy<T>(
    read: (legacy: HybridTokenStorage) => Promise<T>,
  ): Promise<T | null> {
    if (!this.legacy) return null;
    try {
      return await read(this.legacy);
    } catch (error) {
      debugLogger.debug(
        `Legacy credential store unavailable (this is expected on a fresh install): ${error}`,
      );
      return null;
    }
  }

  private async migrate(credentials: OAuthCredentials): Promise<void> {
    try {
      await this.current.setCredentials(credentials);
    } catch (error) {
      // Returning the credentials still lets this session work; the next run
      // simply reads through and tries to migrate again.
      debugLogger.debug(`Failed to migrate stored credentials: ${error}`);
    }
  }
}
